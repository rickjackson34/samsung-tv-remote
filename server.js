import { readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APPS, isKnownApp, isPrivateIPv4, isValidKey } from "./lib/protocol.js";
import { discover, SamsungTV } from "./lib/tv.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const CONFIG_PATH = process.env.REMOTE_CONFIG ?? path.join(ROOT, "config.json");
const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? "0.0.0.0";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

let config = {};
let tv = null;

async function loadConfig() {
  try {
    config = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  } catch {
    config = {};
  }
}

async function saveConfig() {
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function useTv(ip) {
  tv?.close();
  tv = new SamsungTV({ ip, token: config.token, mac: config.mac, secure: config.secure ?? true });
  tv.on("secure", (secure) => {
    config.secure = secure;
    saveConfig().catch(console.error);
  });
  tv.on("token", (token) => {
    config.token = token;
    saveConfig().catch(console.error);
  });
  tv.on("mac", (mac) => {
    config.mac = mac;
    saveConfig().catch(console.error);
  });
  return tv;
}

function requireTv() {
  if (!tv) throw httpError(409, "No TV paired yet. Open Settings to pair your TV.");
  return tv;
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 10_000) throw httpError(413, "Request too large");
  }
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw httpError(400, "Invalid JSON");
  }
}

const routes = {
  "GET /api/status": async () => {
    if (!tv) return { paired: false, apps: APPS };
    const info = await tv.info();
    return {
      paired: Boolean(config.paired),
      ip: config.ip,
      name: info?.name ?? config.name ?? "Samsung TV",
      model: info?.model ?? "",
      power: info?.power ?? "off",
      canWake: Boolean(config.mac),
      apps: APPS,
    };
  },

  "POST /api/discover": async () => ({ tvs: await discover() }),

  "POST /api/pair": async (body) => {
    const ip = String(body.ip ?? "").trim();
    if (!isPrivateIPv4(ip)) throw httpError(400, "Enter the TV's local IP address, e.g. 192.168.1.50");
    if (ip !== config.ip) {
      config = { ip };
      await saveConfig();
    }
    const t = useTv(ip);
    const info = await t.info();
    if (!info) throw httpError(504, `No Samsung TV answered at ${ip}. Make sure it's on and on the same Wi-Fi.`);
    config.name = info.name;
    if (info.mac) config.mac = info.mac;
    await saveConfig();
    await t.connect();
    config.paired = true;
    await saveConfig();
    return { ok: true, name: info.name };
  },

  "POST /api/key": async (body) => {
    if (!isValidKey(body.key)) throw httpError(400, "Unknown key");
    const cmd = body.cmd ?? "Click";
    if (!["Click", "Press", "Release"].includes(cmd)) throw httpError(400, "Unknown command");
    await requireTv().sendKey(body.key, cmd);
    return { ok: true };
  },

  "POST /api/text": async (body) => {
    const text = String(body.text ?? "");
    if (!text || text.length > 500) throw httpError(400, "Text must be 1-500 characters");
    await requireTv().sendText(text);
    return { ok: true };
  },

  "POST /api/app": async (body) => {
    if (!isKnownApp(body.appId)) throw httpError(400, "Unknown app");
    await requireTv().launchApp(body.appId);
    return { ok: true };
  },

  "POST /api/power": async () => ({ ok: true, now: await requireTv().powerToggle() }),

  "POST /api/forget": async () => {
    tv?.close();
    tv = null;
    config = {};
    await saveConfig();
    return { ok: true };
  },
};

async function serveStatic(req, res) {
  const url = new URL(req.url, "http://x");
  const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const file = path.join(PUBLIC, path.normalize(rel));
  if (!file.startsWith(PUBLIC + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://x").pathname;
  const handler = routes[`${req.method} ${pathname}`];
  if (!handler) {
    if (req.method === "GET") return serveStatic(req, res);
    res.writeHead(404).end();
    return;
  }
  try {
    const body = req.method === "POST" ? await readJson(req) : {};
    const result = await handler(body);
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
  } catch (err) {
    res
      .writeHead(err.status ?? 502, { "Content-Type": "application/json" })
      .end(JSON.stringify({ error: err.message }));
  }
});

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === "IPv4" && !a.internal)
    .map((a) => a.address);
}

await loadConfig();
if (config.ip) useTv(config.ip);

server.listen(PORT, HOST, () => {
  console.log("Samsung TV remote is running.");
  console.log("Open one of these on your phone (same Wi-Fi):");
  for (const ip of lanAddresses()) console.log(`  http://${ip}:${PORT}`);
  if (config.ip) console.log(`Paired TV: ${config.name ?? "Samsung TV"} (${config.ip})`);
});
