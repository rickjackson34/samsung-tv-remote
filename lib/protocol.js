// Message builders and helpers for the Samsung Smart TV remote API
// (Tizen TVs, 2016 and newer). The TV listens on:
//   http://<ip>:8001/api/v2/                         device info (JSON)
//   wss://<ip>:8002/api/v2/channels/samsung.remote.control?name=..&token=..
// The first connection from a new app shows an "Allow" prompt on the TV; once
// accepted, the TV sends back a token that skips the prompt next time.

export const APP_NAME = "Phone Remote";

// Remote keys exposed to the phone UI. Anything not on this list is rejected so
// the server can't be used to send arbitrary payloads to the TV.
export const KEYS = new Set([
  "KEY_POWER",
  "KEY_SOURCE",
  "KEY_HOME",
  "KEY_RETURN",
  "KEY_EXIT",
  "KEY_MENU",
  "KEY_INFO",
  "KEY_GUIDE",
  "KEY_TOOLS",
  "KEY_UP",
  "KEY_DOWN",
  "KEY_LEFT",
  "KEY_RIGHT",
  "KEY_ENTER",
  "KEY_VOLUP",
  "KEY_VOLDOWN",
  "KEY_MUTE",
  "KEY_CHUP",
  "KEY_CHDOWN",
  "KEY_PRECH",
  "KEY_CH_LIST",
  "KEY_PLAY",
  "KEY_PAUSE",
  "KEY_STOP",
  "KEY_REWIND",
  "KEY_FF",
  "KEY_RED",
  "KEY_GREEN",
  "KEY_YELLOW",
  "KEY_CYAN",
  "KEY_CAPTION",
  "KEY_HDMI",
  "KEY_0",
  "KEY_1",
  "KEY_2",
  "KEY_3",
  "KEY_4",
  "KEY_5",
  "KEY_6",
  "KEY_7",
  "KEY_8",
  "KEY_9",
]);

// Store app IDs for common streaming apps on Samsung Tizen TVs.
export const APPS = [
  { id: "3201907018807", name: "Netflix" },
  { id: "111299001912", name: "YouTube" },
  { id: "3201910019365", name: "Prime Video" },
  { id: "3201901017640", name: "Disney+" },
  { id: "3202301029760", name: "Max" },
  { id: "3201601007625", name: "Hulu" },
  { id: "3201807016597", name: "Apple TV" },
  { id: "3201606009684", name: "Spotify" },
  { id: "3201512006963", name: "Plex" },
];

const APP_IDS = new Set(APPS.map((a) => a.id));

export function isValidKey(key) {
  return KEYS.has(key);
}

export function isKnownApp(appId) {
  return APP_IDS.has(appId);
}

export function remoteUrl({ ip, token, name = APP_NAME, secure = true, port }) {
  const scheme = secure ? "wss" : "ws";
  const p = port ?? (secure ? 8002 : 8001);
  const params = new URLSearchParams({ name: Buffer.from(name).toString("base64") });
  if (token) params.set("token", token);
  return `${scheme}://${ip}:${p}/api/v2/channels/samsung.remote.control?${params}`;
}

// cmd is "Click" for a tap, or "Press"/"Release" to hold a key down.
export function keyMessage(key, cmd = "Click") {
  if (!isValidKey(key)) throw new Error(`Unknown key: ${key}`);
  if (!["Click", "Press", "Release"].includes(cmd)) throw new Error(`Unknown command: ${cmd}`);
  return {
    method: "ms.remote.control",
    params: { Cmd: cmd, DataOfCmd: key, Option: "false", TypeOfRemote: "SendRemoteKey" },
  };
}

// Types text into whatever on-screen keyboard the TV currently has open.
export function textMessage(text) {
  return {
    method: "ms.remote.control",
    params: {
      Cmd: Buffer.from(text, "utf8").toString("base64"),
      DataOfCmd: "base64",
      TypeOfRemote: "SendInputString",
    },
  };
}

export function launchAppMessage(appId) {
  return {
    method: "ms.channel.emit",
    params: {
      event: "ed.apps.launch",
      to: "host",
      data: { appId, action_type: "DEEP_LINK" },
    },
  };
}

// Wake-on-LAN magic packet: 6 x 0xFF followed by the MAC address 16 times.
export function magicPacket(mac) {
  const hex = String(mac).replace(/[^0-9a-f]/gi, "");
  if (hex.length !== 12) throw new Error(`Invalid MAC address: ${mac}`);
  const macBytes = Buffer.from(hex, "hex");
  const packet = Buffer.alloc(6 + 16 * 6, 0xff);
  for (let i = 0; i < 16; i++) macBytes.copy(packet, 6 + i * 6);
  return packet;
}

// Parses an SSDP response and returns the TV's IP if it looks like a Samsung TV.
export function parseSsdpResponse(text, fromIp) {
  const headers = {};
  for (const line of String(text).split(/\r?\n/).slice(1)) {
    const i = line.indexOf(":");
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  const blob = `${headers.st ?? ""} ${headers.server ?? ""} ${headers.usn ?? ""}`;
  if (!/samsung/i.test(blob)) return null;
  let ip = fromIp;
  if (headers.location) {
    try {
      ip = new URL(headers.location).hostname;
    } catch {
      // fall back to the sender address
    }
  }
  return { ip, server: headers.server ?? "" };
}

export function isPrivateIPv4(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip));
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some((n) => n > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
