import { createPresetStore, makePreset } from "./presets.js";
import { LIBRARY } from "./library.js";
import { initEditor } from "./editor.js";
import { startRace, stopRace } from "./race.js";

const $ = (id) => document.getElementById(id);

const store = createPresetStore(localStorage);

window.toast = (msg, ms = 2600) => {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(window.__toastT);
  window.__toastT = setTimeout(() => el.classList.add("hidden"), ms);
};

function defaultPreset() {
  return makePreset(
    "Demo Loop",
    [
      [160, 130],
      [740, 130],
      [780, 300],
      [690, 470],
      [210, 470],
      [120, 300],
    ],
    14,
    3
  );
}

function stash(preset, mode) {
  sessionStorage.setItem("polytrack.current", JSON.stringify(preset));
  sessionStorage.setItem("polytrack.mode", mode);
}

function readCurrent() {
  try {
    const p = JSON.parse(sessionStorage.getItem("polytrack.current"));
    return p && Array.isArray(p.points) ? p : null;
  } catch {
    return null;
  }
}

function exportPreset(p) {
  const blob = new Blob([JSON.stringify({ app: "polytrack", presets: [p] }, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${String(p.name).replace(/[^\w-]+/g, "_") || "track"}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function presetRow(p, official) {
  const row = document.createElement("div");
  row.className = "preset-row";
  if (official) {
    const badge = document.createElement("span");
    badge.className = `badge ${p.theme}`;
    badge.textContent = p.theme;
    row.appendChild(badge);
  }
  const nm = document.createElement("span");
  nm.className = "nm";
  nm.textContent = p.name;
  const meta = document.createElement("span");
  meta.className = "meta";
  meta.textContent = official
    ? `${p.points.length} pts · ${p.width}m · ${"★".repeat(p.difficulty)}${"☆".repeat(5 - p.difficulty)}`
    : `${p.points.length} pts · ${p.width}m`;
  row.append(nm, meta);
  const mk = (label, cls, fn) => {
    const b = document.createElement("button");
    b.className = `btn small ${cls}`.trim();
    b.textContent = label;
    b.addEventListener("click", fn);
    return b;
  };
  row.append(
    mk("Race", "primary", () => {
      stash(p, "ai");
      location.hash = "#race";
    }),
    mk("Edit", "", () => {
      let target = p;
      if (official) {
        const cp = makePreset(`${p.name} (copy)`, p.points, p.width, p.smoothing, {
          theme: p.theme,
          elev: { ...p.elev },
        });
        store.save(cp);
        document.dispatchEvent(new CustomEvent("polytrack:presets-changed"));
        target = cp;
      }
      editor.load(target);
      location.hash = "#editor";
    }),
    mk("Export", "ghost", () => exportPreset(p))
  );
  if (!official) {
    row.append(
      mk("Delete", "ghost", () => {
        if (confirm(`Delete "${p.name}"?`)) {
          store.remove(p.id);
          document.dispatchEvent(new CustomEvent("polytrack:presets-changed"));
        }
      })
    );
  }
  return row;
}

function renderPresets() {
  const list = store.list();
  $("m-count").textContent = String(list.length);
  const officialRows = $("official-rows");
  const rows = $("preset-rows");
  officialRows.innerHTML = "";
  rows.innerHTML = "";
  for (const p of LIBRARY) officialRows.appendChild(presetRow(p, true));
  for (const p of list) rows.appendChild(presetRow(p, false));
}

const editor = initEditor({
  store,
  onRace: (p) => {
    stash(p, "ai");
    location.hash = "#race";
  },
});

document.addEventListener("polytrack:presets-changed", renderPresets);

$("m-race").addEventListener("click", () => {
  location.hash = "#presets";
});
$("m-editor").addEventListener("click", () => (location.hash = "#editor"));
$("m-presets").addEventListener("click", () => (location.hash = "#presets"));
$("preset-close").addEventListener("click", () => (location.hash = "#menu"));
$("preset-import").addEventListener("change", async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!f) return;
  const n = store.importAll(await f.text());
  toast(n ? `Imported ${n} preset${n === 1 ? "" : "s"}` : "Nothing valid to import");
  document.dispatchEvent(new CustomEvent("polytrack:presets-changed"));
});
$("m-mp").addEventListener("click", async () => {
  try {
    const net = await import("./net.js");
    location.hash = "#lobby";
    net.openLobby({ store });
  } catch {
    toast("Multiplayer arriving");
  }
});
$("res-restart").addEventListener("click", () => {
  if (readCurrent()) location.hash = "#race";
  else location.hash = "#menu";
});
$("res-menu").addEventListener("click", () => (location.hash = "#menu"));

const SCREENS = {
  menu: "screen-menu",
  editor: "screen-editor",
  lobby: "screen-lobby",
  race: "screen-race",
  results: "screen-results",
};
let prevRoute = null;

function route() {
  const raw = (location.hash || "#menu").slice(1);
  const name = raw === "presets" || SCREENS[raw] ? (raw === "presets" ? "menu" : raw) : "menu";
  if (prevRoute === "race" && name !== "race") stopRace();
  for (const [key, id] of Object.entries(SCREENS)) {
    $(id).classList.toggle("active", key === name);
  }
  $("preset-list").classList.toggle("hidden", raw !== "presets");
  if (name === "editor") editor.open();
  if (name === "race") {
    const preset = readCurrent() || defaultPreset();
    const mode = sessionStorage.getItem("polytrack.mode") || "ai";
    const playerName = sessionStorage.getItem("polytrack.myname") || "You";
    startRace({ preset, mode, playerName });
  }
  prevRoute = name;
}
window.addEventListener("hashchange", route);

const probe = document.createElement("canvas");
if (!(probe.getContext("webgl2") || probe.getContext("webgl"))) {
  $("nogl").classList.remove("hidden");
}

renderPresets();
route();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("/sw.js")
    .then(() => ($("m-sw-state").textContent = "ready"))
    .catch(() => ($("m-sw-state").textContent = "unavailable"));
} else {
  $("m-sw-state").textContent = "no support";
}
