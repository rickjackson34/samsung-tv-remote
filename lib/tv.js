import dgram from "node:dgram";
import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { keyMessage, launchAppMessage, magicPacket, parseSsdpResponse, remoteUrl, textMessage } from "./protocol.js";

// Keeps one WebSocket open to the TV and reconnects on demand.
export class SamsungTV extends EventEmitter {
  constructor({ ip, token, mac, secure = true, port, infoPort = 8001, connectTimeoutMs = 30_000 }) {
    super();
    this.ip = ip;
    this.token = token;
    this.mac = mac;
    this.secure = secure;
    this.port = port;
    this.infoPort = infoPort;
    this.connectTimeoutMs = connectTimeoutMs;
    this.ws = null;
    this.ready = null;
  }

  // Resolves once the TV accepts the connection. On first pairing the TV shows
  // an "Allow" prompt, so this can take as long as the user takes to respond.
  connect() {
    if (this.ready) return this.ready;
    this.ready = this.open().catch(async (err) => {
      // 2016 models only speak plain ws:// on port 8001; newer ones want wss://
      // on 8002. If one port refuses outright, try the other once, and only
      // remember the switch if it works: a TV in standby refuses both.
      if (this.port === undefined && err.code === "ECONNREFUSED") {
        this.secure = !this.secure;
        try {
          await this.open();
        } catch {
          this.secure = !this.secure;
          throw err;
        }
        this.emit("secure", this.secure);
        return;
      }
      throw err;
    });
    // Avoid unhandled rejections when nobody is awaiting a dropped connection.
    this.ready.catch(() => {});
    return this.ready;
  }

  open() {
    const url = remoteUrl({ ip: this.ip, token: this.token, secure: this.secure, port: this.port });
    // The TV uses a self-signed certificate.
    const ws = new WebSocket(url, { rejectUnauthorized: false, handshakeTimeout: 5000 });
    this.ws = ws;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        fail(new Error("Timed out waiting for the TV. Check the TV for an Allow prompt."));
      }, this.connectTimeoutMs);

      const fail = (err) => {
        clearTimeout(timer);
        this.reset(ws);
        ws.terminate();
        reject(err);
      };

      ws.on("message", (raw) => {
        let msg;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (msg.event === "ms.channel.connect") {
          clearTimeout(timer);
          const token = msg.data?.token;
          if (token && token !== this.token) {
            this.token = token;
            this.emit("token", token);
          }
          resolve();
        } else if (msg.event === "ms.channel.unauthorized") {
          fail(new Error("The TV denied access. Allow 'Phone Remote' under TV Settings > General > External Device Manager > Device Connection Manager."));
        } else if (msg.event === "ms.channel.timeOut") {
          fail(new Error("The Allow prompt on the TV timed out. Try pairing again."));
        }
      });
      ws.on("error", (err) =>
        fail(Object.assign(new Error(`Can't reach the TV at ${this.ip}: ${err.message}`), { code: err.code })),
      );
      ws.on("close", () => {
        clearTimeout(timer);
        this.reset(ws);
        reject(new Error("The TV closed the connection."));
      });
    });
  }

  reset(ws) {
    if (this.ws === ws) {
      this.ws = null;
      this.ready = null;
    }
  }

  async send(message) {
    await this.connect();
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error("Not connected to the TV.");
    await new Promise((resolve, reject) => ws.send(JSON.stringify(message), (err) => (err ? reject(err) : resolve())));
  }

  sendKey(key, cmd = "Click") {
    return this.send(keyMessage(key, cmd));
  }

  sendText(text) {
    return this.send(textMessage(text));
  }

  launchApp(appId) {
    return this.send(launchAppMessage(appId));
  }

  // Returns the TV's device info, or null if the TV is off or unreachable.
  async info() {
    try {
      const res = await fetch(`http://${this.ip}:${this.infoPort}/api/v2/`, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) return null;
      const body = await res.json();
      const d = body.device ?? {};
      if (d.wifiMac && !this.mac) {
        this.mac = d.wifiMac;
        this.emit("mac", d.wifiMac);
      }
      return {
        name: d.name ?? body.name ?? "Samsung TV",
        model: d.modelName ?? "",
        mac: d.wifiMac ?? "",
        // Newer TVs report "on" or "standby"; older ones omit it and only answer when on.
        power: d.PowerState ?? "on",
      };
    } catch {
      return null;
    }
  }

  async powerToggle() {
    const info = await this.info();
    if (info && info.power !== "standby") {
      try {
        await this.sendKey("KEY_POWER");
        return "off";
      } catch (err) {
        // Many TVs keep answering device info while off but refuse the remote
        // channel. A network-level failure means the TV is asleep, so wake it.
        if (!err.code) throw err;
      }
    }
    if (!this.mac) throw new Error("The TV's MAC address isn't known yet. Turn the TV on once while paired so the remote can learn it.");
    await this.wake(this.mac);
    this.close();
    return "on";
  }

  wake(mac) {
    return wakeOnLan(mac);
  }

  close() {
    const ws = this.ws;
    this.reset(ws);
    ws?.terminate();
  }
}

export function wakeOnLan(mac, { address = "255.255.255.255", port = 9, repeat = 3 } = {}) {
  const packet = magicPacket(mac);
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket("udp4");
    sock.once("error", (err) => {
      sock.close();
      reject(err);
    });
    sock.bind(() => {
      sock.setBroadcast(true);
      let sent = 0;
      const next = () => {
        sock.send(packet, port, address, (err) => {
          if (err) {
            sock.close();
            return reject(err);
          }
          if (++sent >= repeat) {
            sock.close();
            resolve();
          } else {
            setTimeout(next, 100);
          }
        });
      };
      next();
    });
  });
}

// Finds Samsung TVs on the local network via SSDP.
export function discover({ timeoutMs = 3000 } = {}) {
  const query = [
    "M-SEARCH * HTTP/1.1",
    "HOST: 239.255.255.250:1900",
    'MAN: "ssdp:discover"',
    "MX: 2",
    "ST: urn:samsung.com:device:RemoteControlReceiver:1",
    "",
    "",
  ].join("\r\n");

  return new Promise((resolve) => {
    const found = new Map();
    const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    const finish = () => {
      try {
        sock.close();
      } catch {
        // already closed
      }
      resolve([...found.values()]);
    };
    sock.on("message", (msg, rinfo) => {
      const hit = parseSsdpResponse(msg.toString(), rinfo.address);
      if (hit && !found.has(hit.ip)) found.set(hit.ip, hit);
    });
    sock.on("error", finish);
    sock.bind(() => {
      const buf = Buffer.from(query);
      sock.send(buf, 1900, "239.255.255.250");
      setTimeout(() => sock.send(buf, 1900, "239.255.255.250"), 500);
      setTimeout(finish, timeoutMs);
    });
  });
}
