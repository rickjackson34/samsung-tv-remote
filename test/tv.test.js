import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";
import { WebSocketServer } from "ws";
import { SamsungTV } from "../lib/tv.js";

// A stand-in for the TV: device info over HTTP and the remote channel over ws.
let server;
let port;
let wss;
const received = [];
let behavior = "allow";
let connections = 0;

before(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ device: { name: "Living Room", modelName: "QN65", wifiMac: "aa:bb:cc:dd:ee:ff", PowerState: "on" } }));
  });
  wss = new WebSocketServer({ server });
  wss.on("connection", (ws, req) => {
    connections++;
    const url = new URL(req.url, "http://x");
    if (behavior === "deny") {
      ws.send(JSON.stringify({ event: "ms.channel.unauthorized" }));
      return;
    }
    const token = url.searchParams.get("token") ?? "new-token";
    ws.send(JSON.stringify({ event: "ms.channel.connect", data: { token } }));
    ws.on("message", (m) => received.push(JSON.parse(m.toString())));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  port = server.address().port;
});

after(() => {
  wss.close();
  server.close();
});

const makeTv = (opts = {}) => new SamsungTV({ ip: "127.0.0.1", secure: false, port, infoPort: port, ...opts });

test("pairs, stores the token, and sends keys", async () => {
  behavior = "allow";
  const tv = makeTv();
  let token;
  tv.on("token", (t) => (token = t));
  await tv.sendKey("KEY_VOLUP");
  assert.equal(token, "new-token");
  await tv.launchApp("111299001912");
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(received.at(-2).params.DataOfCmd, "KEY_VOLUP");
  assert.equal(received.at(-1).params.data.appId, "111299001912");
  tv.close();
});

test("reuses one connection for multiple commands", async () => {
  behavior = "allow";
  const tv = makeTv({ token: "saved" });
  const before = connections;
  await Promise.all([tv.sendKey("KEY_UP"), tv.sendKey("KEY_DOWN"), tv.sendKey("KEY_ENTER")]);
  await tv.sendKey("KEY_RIGHT");
  assert.equal(connections, before + 1);
  tv.close();
});

test("reconnects after the TV drops the connection", async () => {
  behavior = "allow";
  const tv = makeTv({ token: "saved" });
  await tv.sendKey("KEY_UP");
  for (const c of wss.clients) c.terminate();
  await new Promise((r) => setTimeout(r, 50));
  await tv.sendKey("KEY_DOWN");
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(received.at(-1).params.DataOfCmd, "KEY_DOWN");
  tv.close();
});

test("reports a clear error when the TV denies access", async () => {
  behavior = "deny";
  const tv = makeTv();
  await assert.rejects(tv.sendKey("KEY_UP"), /denied access/);
  tv.close();
});

test("info() reads device details and learns the MAC for Wake-on-LAN", async () => {
  const tv = makeTv();
  let mac;
  tv.on("mac", (m) => (mac = m));
  const info = await tv.info();
  assert.deepEqual(info, { name: "Living Room", model: "QN65", mac: "aa:bb:cc:dd:ee:ff", power: "on" });
  assert.equal(mac, "aa:bb:cc:dd:ee:ff");
});

test("info() returns null when the TV is unreachable", async () => {
  const tv = new SamsungTV({ ip: "127.0.0.1", infoPort: 1 });
  assert.equal(await tv.info(), null);
});

test("powerToggle sends KEY_POWER when the TV is on", async () => {
  behavior = "allow";
  const tv = makeTv({ token: "saved" });
  assert.equal(await tv.powerToggle(), "off");
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(received.at(-1).params.DataOfCmd, "KEY_POWER");
  tv.close();
});

test("powerToggle wakes the TV when it answers info but refuses the remote channel", async () => {
  // Device info answers (like a TV in network standby), but nothing listens for the remote.
  const closed = http.createServer().listen(0, "127.0.0.1");
  await new Promise((r) => closed.once("listening", r));
  const refusedPort = closed.address().port;
  await new Promise((r) => closed.close(r));

  const tv = new SamsungTV({ ip: "127.0.0.1", infoPort: port, mac: "aa:bb:cc:dd:ee:ff" });
  // Simulate the default secure port refusing: point the remote at a closed port.
  tv.port = refusedPort;
  const woken = [];
  tv.wake = async (mac) => woken.push(mac);
  assert.equal(await tv.powerToggle(), "on");
  assert.deepEqual(woken, ["aa:bb:cc:dd:ee:ff"]);
});

test("a refused connection doesn't permanently switch the TV to plain ws", async () => {
  const tv = new SamsungTV({ ip: "127.0.0.1" }); // nothing listens on 8001/8002 here
  let switched = false;
  tv.on("secure", () => (switched = true));
  await assert.rejects(tv.connect(), /ECONNREFUSED/);
  assert.equal(tv.secure, true);
  assert.equal(switched, false);

  const plain = new SamsungTV({ ip: "127.0.0.1", secure: false });
  await assert.rejects(plain.connect(), /ECONNREFUSED/);
  assert.equal(plain.secure, false);
});
