import { createScene } from "./scene.js";
import { worldFromPreset, progressAt, LapTracker, normalAt } from "./track.js";
import { createCarState, stepCar, keyInput, chaseCamera } from "./car.js";
import { createAI, aiInput, separateCars } from "./ai.js";
import { hudInit, hudShow, hudUpdate, hudCountdown, hudNote } from "./hud.js";

const TOTAL_LAPS = 3;
const AI_NAMES = ["Vex", "Juno", "Rook"];
const AI_SKILLS = [0.95, 0.9, 0.86];
const COLORS = [0x22c55e, 0xf59e0b, 0x3b82f6, 0xe11d42];
const CSS_COLORS = ["#22c55e", "#f59e0b", "#3b82f6", "#e11d42"];
const FROZEN_INPUT = { throttle: 0, brake: 0, steerIn: 0 };

let scene = null;
let current = null;

function fmt(ms) {
  if (ms == null || !isFinite(ms)) return "—";
  const t = Math.max(0, ms);
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const d = Math.floor((t % 1000) / 100);
  return `${m}:${String(s).padStart(2, "0")}.${d}`;
}

function wrapAngle(a) {
  return ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
}

export function stopRace() {
  if (!current) return;
  const c = current;
  current = null;
  cancelAnimationFrame(c.raf);
  window.removeEventListener("keydown", c.onKeyDown);
  window.removeEventListener("keyup", c.onKeyUp);
  window.removeEventListener("polytrack:mp-peers", c.onPeers);
  window.removeEventListener("polytrack:mp-finish", c.onMpFinish);
  for (const car of c.cars) c.scene.removeCar(car.mesh);
  hudShow(false);
}

export function startRace({ preset, mode = "ai", playerName = "You" }) {
  stopRace();
  hudInit();
  const canvas = document.getElementById("gl");
  if (!scene) scene = createScene(canvas);
  let mp = mode === "mp" ? window.__mp || null : null;
  if (!mp) mode = "ai";

  const world = worldFromPreset(preset);
  scene.setTrack(world, String(preset.id ?? preset.name ?? "track"));
  scene.resize();
  const spline = world.spline;
  const L = spline.length;
  const half = world.widthWorld / 2;

  // grid slots: staggered two-wide, 6m back of the line, +8m per row
  const startP = spline.pts[0];
  const [nx, nz] = normalAt(spline, 0);
  const fh = world.start.heading;
  const fx = Math.cos(fh);
  const fz = Math.sin(fh);
  const slotPos = (i) => {
    const back = 6 + Math.floor(i / 2) * 8;
    const lat = (i % 2 ? 1 : -1) * half * 0.5;
    return {
      x: startP[0] - fx * back + nx * lat,
      z: startP[1] - fz * back + nz * lat,
    };
  };

  const cars = [];
  const addCarEntry = (name, slot, extra) => {
    const sp = slotPos(slot);
    const state = createCarState(sp.x, sp.z, fh);
    const tracker = new LapTracker(L);
    tracker.armed = false; // first line crossing starts the lap; only full laps count
    const entry = {
      name,
      slot,
      state,
      mesh: scene.addCar(COLORS[slot % COLORS.length]),
      tracker,
      colorCss: CSS_COLORS[slot % CSS_COLORS.length],
      hint: -1,
      lastS: null,
      dirPrev: 1,
      prog: 0,
      lap: 0,
      finished: false,
      finishMs: null,
      best: null,
      lapStart: 0,
      isPlayer: false,
      isRemote: false,
      ai: null,
      id: null,
      ...extra,
    };
    scene.moveCar(entry.mesh, state.x, state.z, state.heading);
    cars.push(entry);
    return entry;
  };

  const player = addCarEntry(playerName || "You", 0, { isPlayer: true });
  if (mode === "ai") {
    for (let i = 0; i < 3; i++) {
      const car = addCarEntry(AI_NAMES[i], i + 1);
      car.ai = createAI(car.state, AI_SKILLS[i]);
    }
  }

  // multiplayer peers
  const onPeers = (e) => syncPeers((e.detail && e.detail.people) || []);
  const onMpFinish = (e) => {
    const car = cars.find((c) => c.isRemote && c.id === e.detail.id);
    if (car && !car.finished) {
      car.finished = true;
      car.finishMs = e.detail.ms;
    }
  };
  function syncPeers(people) {
    const want = new Map();
    if (mp) for (const p of people) if (p.id !== mp.myId) want.set(p.id, p.name || "Peer");
    for (const car of [...cars]) {
      if (car.isRemote && !want.has(car.id)) {
        scene.removeCar(car.mesh);
        cars.splice(cars.indexOf(car), 1);
      }
    }
    for (const [id, name] of want) {
      if (cars.some((c) => c.isRemote && c.id === id)) continue;
      const used = new Set(cars.map((c) => c.slot));
      let slot = 1;
      while (used.has(slot) && slot < 7) slot++;
      addCarEntry(name, slot, { isRemote: true, id });
    }
  }
  if (mp) {
    window.addEventListener("polytrack:mp-peers", onPeers);
    window.addEventListener("polytrack:mp-finish", onMpFinish);
    syncPeers([...(mp.people || new Map())].map(([id, name]) => ({ id, name })));
  }

  // minimap precompute
  const stepN = Math.max(1, Math.floor(spline.pts.length / 300));
  const outline = spline.pts.filter((_, i) => i % stepN === 0);
  const bounds = outline.reduce(
    (b, [x, z]) => ({
      minX: Math.min(b.minX, x),
      maxX: Math.max(b.maxX, x),
      minZ: Math.min(b.minZ, z),
      maxZ: Math.max(b.maxZ, z),
    }),
    { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }
  );

  // snap chase camera behind the player
  scene.camera.position.set(player.state.x - fx * 10, 4.8, player.state.z - fz * 10);
  scene.camera.lookAt(player.state.x + fx * 4, 1.2, player.state.z + fz * 4);

  // countdown: 3s local, or synced to the host's wall clock in multiplayer
  const now0 = performance.now();
  let cdOrigin = now0;
  if (mp && mp.countdownAt) {
    const rem = Math.min(3000, Math.max(0, mp.countdownAt - Date.now()));
    cdOrigin = now0 - (3000 - rem);
  }
  const raceT0 = cdOrigin + 3000;

  const keys = new Set();
  const onKeyDown = (e) => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
    keys.add(e.key);
    if (e.key === "Escape") location.hash = "#menu";
    if (e.key === "r" || e.key === "R") resetPlayer();
  };
  const onKeyUp = (e) => keys.delete(e.key);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  function resetPlayer() {
    const p = progressAt(spline, player.state.x, player.state.z, player.hint);
    player.state.x = spline.pts[p.i][0];
    player.state.z = spline.pts[p.i][1];
    player.state.heading = p.heading;
    player.state.v = 0;
    player.state.steer = 0;
    player.hint = p.i;
  }

  function progressOf(car) {
    return car.lap * L + car.prog;
  }
  function raceOrder() {
    return [...cars].sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished) return (a.finishMs ?? 0) - (b.finishMs ?? 0);
      return progressOf(b) - progressOf(a);
    });
  }

  let ended = false;
  let lastSend = 0;
  let last = performance.now();

  function endRace() {
    if (ended) return;
    ended = true;
    if (mp && mp.sendFinish) mp.sendFinish(player.finishMs);
    const order = raceOrder();
    const tbody = document.querySelector("#res-table tbody");
    tbody.innerHTML = "";
    order.forEach((c, i) => {
      const tr = document.createElement("tr");
      if (c.isPlayer) tr.className = "me";
      const td = (txt) => {
        const el = document.createElement("td");
        el.textContent = txt;
        return el;
      };
      const place = document.createElement("td");
      place.textContent = String(i + 1);
      tr.appendChild(place);
      tr.appendChild(td(c.name));
      tr.appendChild(td(c.finished ? fmt(c.finishMs) : "DNF"));
      tr.appendChild(td(c.best != null ? fmt(c.best) : "—"));
      tbody.appendChild(tr);
    });
    const rows = order.map((c, i) => ({
      place: i + 1,
      name: c.name,
      total: c.finished ? c.finishMs : null,
      best: c.best,
      isPlayer: c.isPlayer,
    }));
    stopRace();
    window.dispatchEvent(new CustomEvent("polytrack:race-done", { detail: { rows, mode } }));
    location.hash = "#results";
  }

  function sampleRemote(car) {
    const buf = mp.buffers.get(car.id);
    if (!buf || !buf.length) return;
    const t = performance.now() - 120;
    let a = buf[0];
    let b = buf[buf.length - 1];
    for (let k = buf.length - 1; k >= 0; k--) {
      if (buf[k].t <= t) {
        a = buf[k];
        b = buf[Math.min(k + 1, buf.length - 1)];
        break;
      }
    }
    const span = b.t - a.t;
    const f = span > 0 ? Math.min(1, Math.max(0, (t - a.t) / span)) : 1;
    car.state.x = a.x + (b.x - a.x) * f;
    car.state.z = a.z + (b.z - a.z) * f;
    car.state.heading = a.heading + wrapAngle(b.heading - a.heading) * f;
    car.state.v = a.v ?? 0;
    car.lap = b.lap ?? 0;
    car.prog = b.s ?? car.prog;
    while (buf.length > 30 && buf[1].t < t - 2000) buf.shift();
  }

  function frame(now) {
    handle.raf = requestAnimationFrame(frame);
    if (current !== handle) return;
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;

    const elapsed = now - cdOrigin;
    const frozen = elapsed < 3000;
    if (frozen) hudCountdown(String(Math.max(1, 3 - Math.floor(elapsed / 1000))));
    else if (elapsed < 3700) hudCountdown("GO!");
    else hudCountdown(null);
    const raceT = now - raceT0;

    const pin = frozen || player.finished ? FROZEN_INPUT : keyInput(keys);
    for (const car of cars) {
      let inp = FROZEN_INPUT;
      if (car.isPlayer) inp = pin;
      else if (car.ai && !car.finished && !frozen) {
        inp = aiInput(car.ai, world, dt, {
          x: player.state.x,
          z: player.state.z,
          lap: player.lap,
        });
      }
      stepCar(car.state, inp, dt, world);
      if (car.ai) car.ai.lap = car.lap;
    }
    separateCars(
      cars.map((c) => c.state),
      3.2
    );

    for (const car of cars) {
      if (car.isRemote) continue;
      const p = progressAt(spline, car.state.x, car.state.z, car.hint);
      car.hint = p.i;
      car.prog = p.s;
      let dir;
      if (car.lastS == null) dir = 1;
      else if (p.s < car.lastS - L * 0.5) dir = 1;
      else if (p.s > car.lastS + L * 0.5) dir = -1;
      else dir = p.s === car.lastS ? car.dirPrev : Math.sign(p.s - car.lastS);
      car.lastS = p.s;
      car.dirPrev = dir;
      if (car.finished) continue;
      const res = car.tracker.update(p.s, dir);
      car.lap = res.lap;
      if (res.wrapped) {
        const dur = raceT - car.lapStart;
        if (dur > 0 && (car.best == null || dur < car.best)) car.best = dur;
        car.lapStart = raceT;
        if (car.lap >= TOTAL_LAPS) {
          car.finished = true;
          car.finishMs = raceT;
          if (car.isPlayer) endRace();
        }
      }
    }
    if (current !== handle) return;

    if (mp) {
      for (const car of cars) if (car.isRemote) sampleRemote(car);
      if (raceT > -100 && now - lastSend >= 66) {
        lastSend = now;
        mp.sendState({
          x: player.state.x,
          z: player.state.z,
          heading: player.state.heading,
          v: player.state.v,
          lap: player.lap,
          s: player.prog,
        });
      }
    }

    chaseCamera(scene.camera, player.state, dt);

    const order = raceOrder();
    hudUpdate({
      speedKmh: Math.abs(player.state.v) * 3.6,
      lap: player.lap,
      lapTotal: TOTAL_LAPS,
      pos: order.indexOf(player) + 1,
      total: cars.length,
      map: {
        outline,
        bounds,
        cars: cars.map((c) => ({ x: c.state.x, z: c.state.z, color: c.colorCss })),
      },
    });
    hudNote(player.state.offTrack ? "OFF TRACK" : "");
    scene.render();
  }

  const handle = {
    raf: 0,
    scene,
    cars,
    onKeyDown,
    onKeyUp,
    onPeers,
    onMpFinish,
  };
  current = handle;
  hudShow(true);
  handle.raf = requestAnimationFrame(frame);
  return handle;
}
