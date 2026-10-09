import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isPrivateIPv4,
  isValidKey,
  keyMessage,
  launchAppMessage,
  magicPacket,
  parseSsdpResponse,
  remoteUrl,
  textMessage,
} from "../lib/protocol.js";

test("remoteUrl encodes the app name and includes the token when known", () => {
  const url = new URL(remoteUrl({ ip: "192.168.1.20", token: "abc" }));
  assert.equal(url.protocol, "wss:");
  assert.equal(url.port, "8002");
  assert.equal(url.pathname, "/api/v2/channels/samsung.remote.control");
  assert.equal(Buffer.from(url.searchParams.get("name"), "base64").toString(), "Phone Remote");
  assert.equal(url.searchParams.get("token"), "abc");
});

test("remoteUrl uses plain ws on 8001 for older TVs and omits a missing token", () => {
  const url = new URL(remoteUrl({ ip: "192.168.1.20", secure: false }));
  assert.equal(url.protocol, "ws:");
  assert.equal(url.port, "8001");
  assert.equal(url.searchParams.has("token"), false);
});

test("keyMessage builds a SendRemoteKey payload", () => {
  assert.deepEqual(keyMessage("KEY_VOLUP"), {
    method: "ms.remote.control",
    params: { Cmd: "Click", DataOfCmd: "KEY_VOLUP", Option: "false", TypeOfRemote: "SendRemoteKey" },
  });
  assert.equal(keyMessage("KEY_UP", "Press").params.Cmd, "Press");
});

test("keyMessage rejects unknown keys and commands", () => {
  assert.equal(isValidKey("KEY_FACTORY"), false);
  assert.throws(() => keyMessage("KEY_FACTORY"));
  assert.throws(() => keyMessage("KEY_UP", "Explode"));
});

test("textMessage base64-encodes UTF-8 text", () => {
  const msg = textMessage("café");
  assert.equal(msg.params.TypeOfRemote, "SendInputString");
  assert.equal(Buffer.from(msg.params.Cmd, "base64").toString("utf8"), "café");
});

test("launchAppMessage targets the host with a deep link", () => {
  const msg = launchAppMessage("3201907018807");
  assert.equal(msg.method, "ms.channel.emit");
  assert.equal(msg.params.event, "ed.apps.launch");
  assert.equal(msg.params.data.appId, "3201907018807");
});

test("magicPacket is 6 x FF followed by the MAC 16 times", () => {
  const p = magicPacket("A0:B1:C2:D3:E4:F5");
  assert.equal(p.length, 102);
  assert.ok(p.subarray(0, 6).every((b) => b === 0xff));
  for (let i = 0; i < 16; i++) {
    assert.equal(p.subarray(6 + i * 6, 12 + i * 6).toString("hex"), "a0b1c2d3e4f5");
  }
  assert.throws(() => magicPacket("not-a-mac"));
});

test("parseSsdpResponse accepts Samsung TVs and ignores other devices", () => {
  const samsung = [
    "HTTP/1.1 200 OK",
    "LOCATION: http://192.168.1.44:7676/smp_15_",
    "SERVER: SHP, UPnP/1.0, Samsung UPnP SDK/1.0",
    "ST: urn:samsung.com:device:RemoteControlReceiver:1",
    "",
  ].join("\r\n");
  assert.deepEqual(parseSsdpResponse(samsung, "192.168.1.44"), {
    ip: "192.168.1.44",
    server: "SHP, UPnP/1.0, Samsung UPnP SDK/1.0",
  });
  const router = "HTTP/1.1 200 OK\r\nST: upnp:rootdevice\r\nSERVER: Linux UPnP/1.0 MiniUPnPd\r\n";
  assert.equal(parseSsdpResponse(router, "192.168.1.1"), null);
});

test("isPrivateIPv4 only allows LAN addresses", () => {
  for (const ip of ["192.168.1.5", "10.0.0.2", "172.16.4.4", "172.31.255.1"]) assert.ok(isPrivateIPv4(ip), ip);
  for (const ip of ["8.8.8.8", "172.32.0.1", "127.0.0.1", "192.168.1.256", "tv.local", ""]) {
    assert.equal(isPrivateIPv4(ip), false, ip);
  }
});
