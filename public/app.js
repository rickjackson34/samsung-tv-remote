const APP_COLORS = {
  Netflix: "#e50914",
  YouTube: "#ff0000",
  "Prime Video": "#00a8e1",
  "Disney+": "#113ccf",
  Max: "#002be7",
  Hulu: "#1ce783",
  "Apple TV": "#333",
  Spotify: "#1db954",
  Plex: "#e5a00d",
};
const DARK_TEXT_APPS = new Set(["Hulu", "Plex"]);

const $ = (sel) => document.querySelector(sel);
const toastEl = $("#toast");
const settingsSheet = $("#settingsSheet");
const keyboardSheet = $("#keyboardSheet");
const pairMessage = $("#pairMessage");

let status = { paired: false };
let inFlight = 0;

async function api(path, body) {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

let toastTimer;
function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3000);
}

function buzz(ms = 12) {
  navigator.vibrate?.(ms);
}

async function command(path, body) {
  if (!status.paired) {
    openSettings();
    return;
  }
  // Drop presses while the TV is backed up so held keys don't keep firing afterward.
  if (inFlight > 3) return;
  inFlight++;
  try {
    await api(path, body);
  } catch (err) {
    toast(err.message);
  } finally {
    inFlight--;
  }
}

function sendKey(key) {
  buzz();
  return command("/api/key", { key });
}

// Keys: tap to send; keys marked data-repeat also auto-repeat while held.
for (const btn of document.querySelectorAll("[data-key]")) {
  let delay;
  let repeat;
  const stop = () => {
    clearTimeout(delay);
    clearInterval(repeat);
    btn.classList.remove("pressed");
  };
  btn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    btn.classList.add("pressed");
    sendKey(btn.dataset.key);
    if (btn.hasAttribute("data-repeat")) {
      delay = setTimeout(() => {
        repeat = setInterval(() => sendKey(btn.dataset.key), 140);
      }, 450);
    }
  });
  for (const ev of ["pointerup", "pointercancel", "pointerleave"]) btn.addEventListener(ev, stop);
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
}

// Power: off sends KEY_POWER, on sends Wake-on-LAN.
$("[data-power]").addEventListener("click", async () => {
  if (!status.paired) return openSettings();
  buzz(25);
  try {
    const { now } = await api("/api/power", {});
    toast(now === "on" ? "Waking up the TV…" : "Turning the TV off");
    setTimeout(refreshStatus, now === "on" ? 6000 : 2500);
  } catch (err) {
    toast(err.message);
  }
});

// Tabs
for (const tab of document.querySelectorAll(".tab")) {
  tab.addEventListener("click", () => {
    for (const t of document.querySelectorAll(".tab")) {
      t.classList.toggle("active", t === tab);
      t.setAttribute("aria-selected", String(t === tab));
    }
    for (const p of document.querySelectorAll("[data-panel]")) {
      p.classList.toggle("hidden", p.dataset.panel !== tab.dataset.tab);
    }
    try {
      localStorage.setItem("tab", tab.dataset.tab);
    } catch {
      // storage unavailable
    }
  });
}
try {
  const saved = localStorage.getItem("tab");
  if (saved) document.querySelector(`.tab[data-tab="${saved}"]`)?.click();
} catch {
  // storage unavailable
}

// Touchpad: every STEP pixels of swipe sends one arrow; a quick tap sends OK.
const pad = $("#touchpad");
const STEP = 42;
let origin = null;
pad.addEventListener("pointerdown", (e) => {
  pad.setPointerCapture(e.pointerId);
  pad.classList.add("active");
  origin = { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, t: Date.now(), moved: false };
});
pad.addEventListener("pointermove", (e) => {
  if (!origin) return;
  const dx = e.clientX - origin.x;
  const dy = e.clientY - origin.y;
  if (Math.abs(dx) >= STEP && Math.abs(dx) > Math.abs(dy)) {
    sendKey(dx > 0 ? "KEY_RIGHT" : "KEY_LEFT");
    origin.x = e.clientX;
    origin.y = e.clientY;
    origin.moved = true;
  } else if (Math.abs(dy) >= STEP) {
    sendKey(dy > 0 ? "KEY_DOWN" : "KEY_UP");
    origin.x = e.clientX;
    origin.y = e.clientY;
    origin.moved = true;
  }
});
const endTouch = (e) => {
  if (!origin) return;
  const dist = Math.hypot(e.clientX - origin.startX, e.clientY - origin.startY);
  if (!origin.moved && dist < 12 && Date.now() - origin.t < 350) sendKey("KEY_ENTER");
  origin = null;
  pad.classList.remove("active");
};
pad.addEventListener("pointerup", endTouch);
pad.addEventListener("pointercancel", () => {
  origin = null;
  pad.classList.remove("active");
});

// Apps
function renderApps(apps) {
  const root = $("#apps");
  root.replaceChildren(
    ...apps.map((app) => {
      const b = document.createElement("button");
      b.className = "key app";
      b.textContent = app.name;
      b.style.background = APP_COLORS[app.name] ?? "var(--surface-2)";
      if (DARK_TEXT_APPS.has(app.name)) b.style.color = "#111";
      b.addEventListener("click", () => {
        buzz();
        command("/api/app", { appId: app.id }).then(() => status.paired && toast(`Opening ${app.name}…`));
      });
      return b;
    }),
  );
}

// Keyboard sheet
$("#openKeyboard").addEventListener("click", () => {
  if (!status.paired) return openSettings();
  $("#keyboardInput").value = "";
  keyboardSheet.showModal();
  $("#keyboardInput").focus();
});
$("#keyboardForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("#keyboardInput").value;
  if (!text) return;
  await command("/api/text", { text });
  keyboardSheet.close();
});

// Settings / pairing sheet
function openSettings() {
  if (status.ip) $("#ipInput").value = status.ip;
  pairMessage.textContent = "";
  pairMessage.className = "message";
  $("#forgetBtn").classList.toggle("hidden", !status.ip);
  settingsSheet.showModal();
}
$("#openSettings").addEventListener("click", openSettings);
for (const btn of document.querySelectorAll("[data-close]")) {
  btn.addEventListener("click", () => btn.closest("dialog").close());
}

function setPairMessage(text, kind = "") {
  pairMessage.textContent = text;
  pairMessage.className = `message ${kind}`;
}

$("#discoverBtn").addEventListener("click", async () => {
  const list = $("#foundList");
  const btn = $("#discoverBtn");
  btn.disabled = true;
  btn.textContent = "Searching…";
  list.replaceChildren();
  try {
    const { tvs } = await api("/api/discover", {});
    if (!tvs.length) {
      setPairMessage("No TVs found. Enter the IP address manually.", "error");
    } else {
      setPairMessage("");
      for (const t of tvs) {
        const b = document.createElement("button");
        b.type = "button";
        b.innerHTML = `Samsung TV<small></small>`;
        b.querySelector("small").textContent = t.ip;
        b.addEventListener("click", () => {
          $("#ipInput").value = t.ip;
        });
        list.append(b);
      }
      if (tvs.length === 1) $("#ipInput").value = tvs[0].ip;
    }
  } catch (err) {
    setPairMessage(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Find my TV";
  }
});

$("#pairForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#pairBtn");
  btn.disabled = true;
  setPairMessage("Look at your TV and choose Allow…");
  try {
    const { name } = await api("/api/pair", { ip: $("#ipInput").value });
    setPairMessage(`Connected to ${name}!`, "success");
    await refreshStatus();
    setTimeout(() => settingsSheet.close(), 900);
  } catch (err) {
    setPairMessage(err.message, "error");
  } finally {
    btn.disabled = false;
  }
});

$("#forgetBtn").addEventListener("click", async () => {
  await api("/api/forget", {}).catch(() => {});
  $("#ipInput").value = "";
  setPairMessage("TV forgotten.");
  await refreshStatus();
});

async function refreshStatus() {
  try {
    status = await api("/api/status");
  } catch {
    status = { paired: false, offline: true };
  }
  const dot = $("#statusDot");
  dot.className = "dot";
  if (status.offline) {
    $("#tvName").textContent = "Remote server offline";
  } else if (!status.paired) {
    $("#tvName").textContent = "Tap ⚙ to connect";
  } else {
    $("#tvName").textContent = status.name;
    if (status.power === "on") dot.classList.add("on");
    else if (status.power === "standby") dot.classList.add("standby");
  }
  if (status.apps) renderApps(status.apps);
  return status;
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshStatus();
});
setInterval(() => document.visibilityState === "visible" && refreshStatus(), 15000);

refreshStatus().then((s) => {
  if (!s.paired && !s.offline) openSettings();
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
