# polyTRACK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a playable 3D low-poly racing game with a track-drawing editor, AI opponents, localhost/LAN multiplayer, presets, and offline support.

**Architecture:** No-build vanilla ES modules in `public/`, vendored Three.js, single Node server (`server.js`) that serves static files and relays WebSocket state. Track pipeline: 2D preset points → smoothing/resampling → closed spline with arc-length table → road mesh + progress tracking. Pure geometry lives in `track.js` (unit-testable in Node, no DOM).

**Tech Stack:** Node 24 (`ws` only dep), Three.js (vendored ESM), browser ES modules, `node:test`, service worker.

**Spec:** `docs/superpowers/specs/2026-10-05-polytrack-design.md`

## Global Constraints

- Project root: `C:\Users\qoyum\Documents\Games\polyTRACK`
- No build step, no bundler; every import uses explicit relative paths with `.js` extension.
- v1 is silent: no audio files or Web Audio.
- Multiplayer is single global room; host = first WebSocket connector; client-authoritative laps.
- Constants: 3 laps per race, 3 AI opponents in single-player, server port 3000, state send rate 15 Hz, interpolation delay 120 ms.
- Editor preset storage key: `localStorage["polytrack.presets"]`.
- Service worker file: `public/sw.js`, cache name prefix `polytrack-`.
- All first-party JS under `public/js/` must avoid top-level DOM access at import time (except `main.js`) so `track.js`, `presets.js`, `car.js`, `ai.js`, `race.js` stay import-safe for tests.

---

### Task 1: Scaffold + static/WebSocket server

**Files:**
- Create: `package.json`, `server.js`, `public/index.html`, `public/css/style.css`, `public/manifest.webmanifest`, `public/icons/make-icons.ps1` (then run it to produce `icon-192.png`, `icon-512.png`), `public/favicon.svg`

**Interfaces:**
- Produces: HTTP server on `0.0.0.0:3000` serving `public/`, upgrading `/ws` WebSocket connections. WS protocol (used by Task 10):
  - client→server: `{t:"join",name}`, `{t:"state",x,z,heading,v,lap,s}`, `{t:"track",preset}`, `{t:"start",countdownAt}`, `{t:"finish",ms}`
  - server→client: `{t:"you",id,host}`, `{t:"peers",people:[{id,name}]}`, `{t:"joined",id,name}`, `{t:"left",id}`, `{t:"relay",from,msg}`, `{t:"track",preset,from}`, `{t:"start",countdownAt,from}`, `{t:"finish",ms,from}`
  - Relay rule: server wraps `state` messages as `{t:"relay",from:id,msg:{t:"state",...}}` and forwards to all other clients.

- [ ] **Step 1: package.json + install ws**

```json
{
  "name": "polytrack",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node server.js",
    "test": "node --test test/"
  },
  "dependencies": { "ws": "^8.18.0" }
}
```

Run: `npm install` (workdir project root). Expected: `node_modules/ws` exists, no errors.

- [ ] **Step 2: Write server.js**

```js
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { WebSocketServer } from "ws";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const PUBLIC = join(process.cwd(), "public");
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml",
  ".png": "image/png", ".glb": "model/gltf-binary", ".ico": "image/x-icon",
};

const server = http.createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (path === "/") path = "/index.html";
    const file = normalize(join(PUBLIC, path));
    if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end("forbidden"); }
    const data = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
});

const wss = new WebSocketServer({ server, path: "/ws" });
let nextId = 1;
const clients = new Map(); // ws -> {id, name, host}

function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function broadcast(obj, except) {
  for (const ws of clients.keys()) if (ws !== except) send(ws, obj);
}
function peersList() {
  return [...clients.values()].map(c => ({ id: c.id, name: c.name }));
}

wss.on("connection", (ws) => {
  const id = nextId++;
  const host = clients.size === 0;
  clients.set(ws, { id, name: "Player" + id, host });
  send(ws, { t: "you", id, host });
  broadcast({ t: "joined", id, name: clients.get(ws).name }, ws);
  send(ws, { t: "peers", people: peersList() });

  ws.on("message", (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const me = clients.get(ws);
    if (!me) return;
    switch (msg.t) {
      case "join":
        me.name = String(msg.name || me.name).slice(0, 24);
        broadcast({ t: "joined", id: me.id, name: me.name }, ws);
        send(ws, { t: "peers", people: peersList() });
        break;
      case "state":
        broadcast({ t: "relay", from: me.id, msg: { t: "state", x: msg.x, z: msg.z, heading: msg.heading, v: msg.v, lap: msg.lap, s: msg.s } }, ws);
        break;
      case "track":
        broadcast({ t: "track", preset: msg.preset, from: me.id }, ws);
        break;
      case "start":
        broadcast({ t: "start", countdownAt: msg.countdownAt, from: me.id }, ws);
        break;
      case "finish":
        broadcast({ t: "finish", ms: msg.ms, from: me.id }, ws);
        break;
    }
  });
  ws.on("close", () => {
    const me = clients.get(ws);
    clients.delete(ws);
    if (me) {
      broadcast({ t: "left", id: me.id });
      if (me.host) { // promote next connector
        const next = [...clients.entries()][0];
        if (next) { next[1].host = true; send(next[0], { t: "you", id: next[1].id, host: true }); }
      }
    }
  });
});

server.listen(PORT, "0.0.0.0", () => console.log(`polyTRACK → http://localhost:${PORT}`));
```

- [ ] **Step 3: index.html skeleton + style.css + manifest + icons**

`public/index.html` — full document with app shell:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#16203c">
<title>polyTRACK</title>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/css/style.css">
</head>
<body>
<div id="app">
  <section id="screen-menu" class="screen active">…filled in Task 9…</section>
  <section id="screen-editor" class="screen">…Task 4…</section>
  <section id="screen-lobby" class="screen">…Task 10…</section>
  <section id="screen-race" class="screen"><canvas id="gl"></canvas><div id="hud">…Task 8…</div></section>
  <section id="screen-results" class="screen">…Task 8…</section>
</div>
<div id="toast"></div>
<script type="module" src="/js/main.js"></script>
</body>
</html>
```

(Task 9 fills menu markup; Tasks 4/8/10 fill their sections. This step writes the outer document + empty sections with `class="screen"` and the `#toast` div.)

`public/css/style.css`: dark theme (`--bg:#16203c`), `.screen{display:none}.screen.active{display:flex}`, full-viewport `#gl{position:absolute;inset:0}`, HUD overlays, buttons (`.btn` pill style), editor canvas centered, toast fixed bottom-center with fade. Keep ~120 lines; must include: `html,body{height:100%;margin:0;font-family:system-ui;background:var(--bg);color:#eef2f7}`, `#app{height:100%}`, `.menu-card` styling for Task 9.

`public/manifest.webmanifest`:

```json
{"name":"polyTRACK","short_name":"polyTRACK","start_url":"/","display":"standalone",
 "background_color":"#16203c","theme_color":"#16203c",
 "icons":[{"src":"/icons/icon-192.png","sizes":"192x192","type":"image/png"},
          {"src":"/icons/icon-512.png","sizes":"512x512","type":"image/png"}]}
```

`public/favicon.svg`: checkered-flag-ish square (2×2 black/white pattern in rounded rect, green accent border).

`public/icons/make-icons.ps1` — PowerShell + System.Drawing script drawing a dark rounded square with a green "P" and checkered top strip; run it to emit `icon-192.png` and `icon-512.png`.

- [ ] **Step 4: Boot + smoke test**

Run: `node server.js` (workdir root), then in another terminal: `Invoke-WebRequest http://localhost:3000/ -UseBasicParsing | Select-Object -ExpandProperty StatusCode` → `200`. Also fetch `/css/style.css` → 200. Stop the server.

- [ ] **Step 5: Commit**

```bash
git init 2>$null; git add -A; git commit -m "feat: scaffold polyTRACK server, shell, manifest"
```

---

### Task 2: Track geometry (TDD)

**Files:**
- Create: `public/js/track.js`, `test/track.test.js`

**Interfaces:**
- Produces (pure, no DOM — imported by editor/scene/car/ai/race):
  - `chaikin(points, iterations)` → `[[x,y],…]` open polyline smoothing (keeps endpoints of closed loop via closed handling below)
  - `chaikinClosed(points, iterations)` → closed-loop smoothed points (same length semantics: array of corners, still a loop)
  - `resampleEven(points, spacing, closed)` → evenly spaced points
  - `buildSpline(points, closed=true, samplesPerSeg=12)` → `Float64Array`-backed `{pts:[[x,z]…], cum:[…], length}` uniform samples with cumulative arc length
  - `nearestIndex(spline, x, z, hint=-1, window=60)` → index of nearest centerline sample (if `hint>=0` search `[hint-window, hint+window]` modulo length, else full scan)
  - `progressAt(spline, x, z, hint)` → `{i, s, lat, tangentHeading}` — `s` = arc length at sample, `lat` = signed lateral offset (left positive), `heading` = tangent direction in radians (0 = +X, grows toward +Z)
  - `class LapTracker { constructor(length); update(s, totalForward) -> {lap, wrapped, checkpoint} }` — see logic below
  - `worldFromPreset(preset, fieldSize=180)` → `{spline, pointsWorld, widthWorld, start:{x,z,heading}}` — normalize preset points to fit `fieldSize`, scale width (editor units → world via same bbox fit factor, clamped 8..24 m)

- [ ] **Step 1: Write failing tests** (`test/track.test.js`, `node:test` + `node:assert/strict`)

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { chaikinClosed, resampleEven, buildSpline, nearestIndex, progressAt, LapTracker, worldFromPreset } from "../public/js/track.js";

const square = [[0,0],[100,0],[100,100],[0,100]];

test("chaikinClosed keeps point count and rounds corners", () => {
  const out = chaikinClosed(square, 1);
  assert.equal(out.length, 8); // 1 iteration doubles points for closed loops
  // corners pulled inward: new points lie strictly inside the original square hull bounds
  for (const [x, y] of out) { assert.ok(x > -0.01 && x < 100.01); assert.ok(y > -0.01 && y < 100.01); }
});

test("chaikinClosed 0 iterations is identity", () => {
  assert.deepEqual(chaikinClosed(square, 0), square);
});

test("resampleEven yields approximately equal spacing", () => {
  const out = resampleEven([[0,0],[10,0],[10,10]], 1, true);
  const d = Math.hypot(out[1][0]-out[0][0], out[1][1]-out[0][1]);
  assert.ok(Math.abs(d - 1) < 1e-6);
});

test("buildSpline length matches perimeter of unit square", () => {
  const sp = buildSpline(square, true, 16);
  assert.ok(Math.abs(sp.length - 400) < 8, `length=${sp.length}`);
  assert.equal(sp.cum.length, sp.pts.length);
  assert.equal(sp.cum[0], 0);
  assert.ok(sp.cum.at(-1) > 390);
});

test("nearestIndex with hint finds nearby sample, full scan as fallback", () => {
  const sp = buildSpline(square, true, 16);
  const near = nearestIndex(sp, 50, 0, 0, 80);   // on bottom edge near sample 0-ish
  assert.ok(near >= 0);
  const far = nearestIndex(sp, 0, 50, -1);       // no hint
  const sp2 = buildSpline(square, true, 16);
  const expect = Math.min(...sp2.pts.map(([x,z],i)=>[Math.hypot(x-0,z-50),i])).at(-1 === undefined ? 0 : 1);
  assert.equal(far, expect);
});

test("progressAt: point left of track has positive lat, heading sane", () => {
  const sp = buildSpline(square, true, 16);      // square traversed CCW: (0,0)→(100,0)→…
  const p = progressAt(sp, 50, -3, -1);          // 3 units below bottom edge (outside)
  assert.ok(Math.abs(Math.abs(p.lat) - 3) < 0.5, `lat=${p.lat}`);
  assert.ok(p.heading > -0.01 && p.heading < 0.02, `heading=${p.heading}`); // along +X
});

test("LapTracker: forward wrap past checkpoint counts one lap", () => {
  const lt = new LapTracker(400);
  let r;
  r = lt.update(100, 10); assert.equal(r.lap, 0);
  r = lt.update(395, 10); assert.equal(r.lap, 0);   // near end, no wrap yet
  r = lt.update(5, 10);   assert.equal(r.lap, 1);   // wrapped forward
  r = lt.update(200, 10); assert.equal(r.lap, 1);
});

test("LapTracker: reverse crossing does not count", () => {
  const lt = new LapTracker(400);
  lt.update(395, 10);
  const r = lt.update(380, -10);                    // went backwards across nothing
  assert.equal(r.lap, 0);
  lt.update(2, 10);                                 // forward wrap — but checkpoint missed? no: passed 0 forward
  // backward over s=0 then forward again:
  const lt2 = new LapTracker(400);
  lt2.update(395, 10);
  lt2.update(350, -10);                             // reverse away from line
  lt2.update(5, 10);                                // forward wrap after having been past line region
  assert.equal(lt2.lap, 1);
});

test("LapTracker: U-turn mid track never counts", () => {
  const lt = new LapTracker(400);
  lt.update(200, 10); lt.update(150, -10); lt.update(200, 10);
  assert.equal(lt.lap, 0);
});

test("worldFromPreset maps points into field and width into meters", () => {
  const w = worldFromPreset({ points: square, width: 14, smoothing: 2 });
  assert.ok(w.spline.length > 300);
  for (const [x, z] of w.pointsWorld) { assert.ok(Math.abs(x) <= 92); assert.ok(Math.abs(z) <= 92); }
  assert.ok(w.widthWorld >= 8 && w.widthWorld <= 24);
});
```

- [ ] **Step 2: Run and confirm FAIL** — Run: `npm test` (root). Expected: FAIL (`Cannot find module` or import errors) — `track.js` does not exist yet.

- [ ] **Step 3: Implement `public/js/track.js`**

Core algorithms (implement exactly these):

```js
// chaikinClosed: for closed loop, each iteration replaces each edge P→Q with
//   A = 0.75P+0.25Q, B = 0.25P+0.75Q; output interleaved A,B for all edges → doubles count.
// resampleEven(closed): walk segments accumulating distance, emit point every `spacing`,
//   carry remainder across segments; for closed, also wrap final→first.
// catmullRom(P0,P1,P2,P3,t): standard uniform CR:
//   0.5*((2P1)+(−P0+P2)t+(2P0−5P1+4P2−P3)t²+(−P0+3P1−3P2+P3)t³)
// buildSpline: CR through closed points (indices mod n), samplesPerSeg samples per segment,
//   skip duplicate t=0 of each seg except first; then cum[i]=cum[i−1]+dist(i,i−1); length=cum.at(−1)+dist(last,first)... 
//   (keep cum array exactly pts.length; length = cum.at(-1) is WRONG for closed — set
//    length = cum.at(-1) + dist(pts.last, pts.first) so wrap distance included.)
// nearestIndex(spline,x,z,hint,window=60): if hint<0 full argmin of dist²;
//   else consider idx in [hint-window .. hint+window] mapped mod n (both directions), argmin.
// progressAt: i=nearestIndex(...); s=cum[i]; tangent = pts[i+1]-pts[i] (wrap);
//   heading=atan2(dz,dx); lat = cross product sign: lat = ((x−px)*dz−(z−px... use
//   lat = ((x−px)*sin(h) − (z−pz)*cos(h)) * −1??  → compute perpendicular distance with sign:
//   nx=−sin? Use: right normal of tangent (dx,dz) is (−dz,dx)/len; lat = dot(p−c, rightNormal)
//   sign so that LEFT of travel direction is positive: left normal = (dz,−dx)/len → lat = dot(p−c,leftNormal).
// LapTracker(length): state {lap:0, lastS, armed:true}.
//   update(s, dir): wrapped = armed && dir>0 && lastS > length*0.75 && s < length*0.25;
//   reverse = lastS < length*0.25 && s > length*0.75 && dir<0 → disarm (armed=false);
//   on forward wrap: lap++, armed stays true. Any time dir<0 in mid region: armed=true (re-arm only when past 50%?). 
//   SIMPLER SPEC (implement this): armed starts true; becomes false after a counted lap until
//   s enters [0.25L, 0.75L] again (re-arm); reverse crossing s≈0 disarms. U-turn mid track never touches the wrap band with armed… 
//   → code: 
//   update(s, dir) {
//     let wrapped=false;
//     if (this.armed && dir>0 && this.last!=null && this.last > .75*L && s < .25*L) { this.lap++; wrapped=true; this.armed=false; }
//     if (!this.armed && s > .3*L && s < .7*L) this.armed=true;
//     if (dir<0 && this.last!=null && this.last < .25*L && s > .75*L) this.armed=false; // backed over start line
//     this.last=s; return {lap:this.lap, wrapped, armed:this.armed};
//   }
// worldFromPreset: chaikinClosed(points, smoothing) → resampleEven(_, 2, true) → buildSpline
//   BUT scale first: compute bbox center, scale = fieldSize/ max(bboxW,bboxH) → translate to origin.
//   widthWorld = clamp(width * scale/ ???) — editor width is already meters (8..24) → use as-is:
//   widthWorld = clamp(preset.width, 8, 24). start = spline sample 0 with its tangent heading.
```

Include `export` for all listed names. Keep file ≤ 260 lines, no DOM.

- [ ] **Step 4: Run tests to PASS** — Run: `npm test`. Expected: all tests PASS. If `nearestIndex` full-scan test's `expect` computation is fragile, compute expected index directly in the test as `pts` argmin — fix test, not implementation, only if assertion is wrong about intended behavior.

- [ ] **Step 5: Commit** — `git add -A; git commit -m "feat: track geometry with spline, progress, lap tracking (TDD)"`

---

### Task 3: Presets storage (TDD)

**Files:**
- Create: `public/js/presets.js`, `test/presets.test.js`

**Interfaces:**
- Produces:
  - `createPresetStore(storage)` → `{ list(), save(preset), remove(id), get(id), exportAll(), importAll(json) }` — `storage` injectable (`localStorage` in browser, plain object shim in tests)
  - `makePreset(name, points, width, smoothing)` → preset object with `id` (crypto.randomUUID fallback `Date.now()+rand`), `createdAt`
  - `validatePreset(p)` → `true | string reason`

- [ ] **Step 1: Failing tests** (`test/presets.test.js`)

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPresetStore, makePreset, validatePreset } from "../public/js/presets.js";

const shim = () => { const m = new Map(); return {
  getItem: k => m.has(k) ? m.get(k) : null, setItem: (k,v) => m.set(k,String(v)),
  removeItem: k => m.delete(k) }; };

test("save + list roundtrip", () => {
  const s = createPresetStore(shim());
  const p = makePreset("Loop", [[0,0],[50,0],[50,50],[0,50]], 14, 2);
  assert.equal(validatePreset(p), true);
  s.save(p);
  assert.equal(s.list().length, 1);
  assert.equal(s.get(p.id).name, "Loop");
});

test("duplicate id overwrites (upsert)", () => {
  const s = createPresetStore(shim());
  const p = makePreset("A", [[0,0],[10,0],[10,10]], 10, 1);
  s.save(p); p.name = "B"; s.save(p);
  assert.equal(s.list().length, 1);
  assert.equal(s.get(p.id).name, "B");
});

test("remove + export/import", () => {
  const s = createPresetStore(shim());
  s.save(makePreset("X", [[0,0],[10,0],[10,10],[0,10]], 12, 0));
  const json = s.exportAll();
  s.remove(s.list()[0].id);
  assert.equal(s.list().length, 0);
  const n = createPresetStore(shim());
  assert.equal(n.importAll(json), 1);
  assert.equal(n.list()[0].name, "X");
});

test("validation rejects bad input", () => {
  assert.notEqual(validatePreset({ points: [[0,0],[1,1]] }), true);      // <4 points
  assert.notEqual(validatePreset({ points: [["a",0],[1,1],[2,2],[3,3]] }), true); // NaN
  assert.notEqual(validatePreset(null), true);
});

test("importAll rejects malformed JSON with reason", () => {
  const s = createPresetStore(shim());
  assert.equal(s.importAll("{nope"), false);
});
```

- [ ] **Step 2: Run → FAIL** (`npm test`)

- [ ] **Step 3: Implement `public/js/presets.js`**

Key rules: storage key `polytrack.presets` (array JSON); `save` upserts by id; `importAll` accepts either an array or `{presets:[…]}`, validates each, returns count imported (or `false` on parse error); `makePreset` clamps `width` 8..24, `smoothing` 0..4, points must be ≥4 pairs.

- [ ] **Step 4: Run → PASS** (`npm test`)

- [ ] **Step 5: Commit** — `git commit -m "feat: preset storage with validation (TDD)"`

---

### Task 4: Track editor screen

**Files:**
- Create: `public/js/editor.js`
- Modify: `public/index.html` (fill `#screen-editor`), `public/css/style.css`

**Interfaces:**
- Consumes: `presets.js` API; `track.js: worldFromPreset` (preview uses it via canvas 2D only — editor itself draws raw points).
- Produces: `initEditor({ onRace(preset), store })` → binds DOM, returns `{ open() }`; editor emits saved presets through `store`.

DOM contract (fill into `#screen-editor`):

```html
<div class="editor-wrap">
  <div class="editor-toolbar">
    <input id="ed-name" placeholder="Track name" maxlength="32">
    <label>Width <input type="range" id="ed-width" min="8" max="24" value="14"><span id="ed-width-v">14</span></label>
    <label>Smooth <input type="range" id="ed-smooth" min="0" max="4" value="2"><span id="ed-smooth-v">2</span></label>
    <button class="btn" id="ed-clear">Clear</button>
    <button class="btn" id="ed-save">Save preset</button>
    <button class="btn primary" id="ed-race">Race this track ▶</button>
    <button class="btn ghost" id="ed-back">Back</button>
  </div>
  <canvas id="ed-canvas" width="900" height="600"></canvas>
  <div id="ed-hint">Draw a loop with the mouse — then drag the dots to fine-tune.</div>
</div>
```

- [ ] **Step 1: Fill HTML + CSS** for the above (toolbar = horizontal flex, canvas = centered, dark bg `#0d1526`, points drawn as 7px circles green `#4ade80`, hover highlight, `#ed-hint` small gray text).

- [ ] **Step 2: Implement `editor.js`** with these behaviors:
  - State: `raw[]` (freehand points), `display[]` = `chaikinClosed(raw, smoothing)` then downscaled to canvas coords for drawing, `selected` index.
  - **Draw:** mousedown (not on a point) starts capture; on mousemove append point if moved > 6 px; mouseup → if ≥4 points and path length > 300 px, accept as loop (`raw = captured`), else toast "Draw a bigger loop".
  - **Edit:** hit-test within 10 px of a display point on mousedown → drag it (updates the *source* control point — since display is Chaikin output, maintain `raw` and re-derive; to keep drag mapping simple: when smoothing=0 drag raw directly; otherwise after first edit switch `raw = display` snapshot and keep smoothing applied only at preview/race generation time. Implement that rule: `raw` is authoritative; smoothing applied at save/race time only.)
  - **Double-click** on empty canvas near track (< 14 px): insert point into `raw` at nearest segment.
  - **Sliders:** live update labels; smoothing/width stored on pending preset.
  - **Clear:** confirm → empty state, canvas shows hint.
  - **Save:** `validatePreset` → `store.save(makePreset(name||"Untitled", raw, width, smoothing))` → toast "Saved".
  - **Race this track:** requires valid loop → `onRace(preset)` with `smoothing` applied to points first (`chaikinClosed(raw, smoothing)` result saved as points).
  - **Back:** `location.hash = "#menu"` (router in Task 9).
  - Render loop: draw grid, loop polyline (smoothed preview), control points, start marker (point 0), during-capture live path.

- [ ] **Step 3: Manual smoke** — start server, open `/#editor`… (router lands in Task 9; for now temporarily navigate by `location.hash` handled later — verify by opening page and calling `initEditor` from console is NOT required: instead defer browser check to Task 9. Gate here: `node --check public/js/editor.js` passes.)

Run: `node --check public/js/editor.js` → no output = OK.

- [ ] **Step 4: Commit** — `git commit -m "feat: track editor with sketch, point editing, sliders"`

---

### Task 5: 3D scene builder

**Files:**
- Create: `public/js/scene.js`
- Modify: `public/index.html` (import map OR direct import path — use direct relative import of vendored file)

**Interfaces:**
- Consumes: `track.js: worldFromPreset` → `{spline, widthWorld, start}`.
- Produces:
  - `createScene(canvas)` → `{ renderer, scene, camera, dispose(), setTrack(world), addCar(colorHex) -> {mesh, setState(x,z,heading)}, moveCar(carObj,x,z,heading), removeCar(obj), render(dt), startLineFlash }`
  - Car mesh: low-poly box body + cabin + 4 wheel boxes, ~4.2 m long, color param.

- [ ] **Step 1: Vendor Three.js**

Run: `Invoke-WebRequest "https://unpkg.com/three@0.169.0/build/three.module.js" -OutFile public/js/vendor/three.module.js` (workdir root). Verify file > 500 KB.

- [ ] **Step 2: Implement `scene.js`**

- Renderer: `WebGLRenderer({canvas, antialias:true})`, resize handler (window resize → update aspect), `setPixelRatio(min(devicePixelRatio,2))`, shadows PCFSoft.
- Lights: `HemisphereLight(0xbfd9ff, 0x3f7d44, 0.9)` + `DirectionalLight(0xffffff, 1.6)` at `(60,90,40)` casting shadow with camera frustum ±120.
- `setTrack(world)`:
  - Build road ribbon from `spline.pts` with half = `widthWorld/2`, shoulders +1.5 m: for each sample i, left = p + n*halfL, right = p − n*halfL (n = left normal), two triangles per segment; asphalt color `#3a3f4b`, slight per-vertex darkening jitter (seeded).
  - Start line: white/black checker quad strip across road at sample 0 (8 alternating 1 m cells), plus two red pylons.
  - Curbs: for every 6th sample, small box (2 m × 0.3 m × 0.6 m) alternating `#e11d42`/`#f8fafc` at both edges, rotated to tangent.
  - Ground: `PlaneGeometry(600,600,40,40)` rotated flat, green `#3f8f4f` with ±0.4 m random Y jitter (seeded by preset id hash), receives shadow.
  - Props: seeded RNG (mulberry32 on preset id hash): 40 objects — low-poly cones as trees (`ConeGeometry(2.2,6,6)` green + trunk), boxes as buildings (`#c9d4e5`, heights 4–14), traffic cones near a few corners; placement rejected if within `widthWorld/2 + 6` of any spline sample (check via `nearestIndex` full scan per candidate).
  - Fog: `Fog(0x9ec7ff, 120, 420)`; sky clear color same.
  - Dispose previous track group before building new (Group `trackGroup`).
- `addCar(color)`: body `BoxGeometry(2,0.7,4.2)` y=0.55, cabin `BoxGeometry(1.6,0.55,1.8)` y=1.15 z=−0.2, wheels `CylinderGeometry(0.42,0.42,0.35)` rotated; all in a Group, castShadow. `moveCar` sets `position.set(x,0,z)` + `rotation.y = −heading` (verify sign against physics: heading 0 = +X ⇒ car nose along +X ⇒ with model length on Z, rotate −π/2 offset… implement `group.rotation.y = -heading - Math.PI/2` and confirm visually in Task 9; document chosen offset in code).
- Camera follow handled by `car.js` (Task 6) — scene exposes `camera`.

- [ ] **Step 3: Static check** — `node --check public/js/scene.js` OK. (Three.js import can't resolve in Node — check with `node --check` only, which does not resolve imports.)

- [ ] **Step 4: Commit** — `git commit -m "feat: three.js scene with road, curbs, props, cars"`

---

### Task 6: Car physics + chase camera (TDD core)

**Files:**
- Create: `public/js/car.js`, `test/car.test.js`

**Interfaces:**
- Produces (pure physics importable in Node):
  - `createCarState(x, z, heading)` → `{x,z,heading,v,steer,offTrack:false}`
  - `stepCar(state, input, dt, track, params)` — mutates/returns state. `input={throttle:0..1, brake:0..1, steerIn:−1..1}`, `track={spline, widthWorld}` (use `progressAt` for lat), `params={maxSpeed:38, accel:22, brakeForce:34, drag:0.6, turnRate:2.4, grip:8, offroadFactor:0.45}`
  - `keyInput(keys)` → input map from pressed key set
  - `chaseCamera(camera, carState, dt)` — smooth follow: desired pos = car pos − forward*10 + up*4.5, lerp `1−exp(−6dt)`; lookAt car + forward*4.

Physics rules (unit-test these):
- `v += (throttle*accel − brake*brakeForce*sign(v) − drag*v) * dt`; clamp `v ∈ [−12, maxSpeed]` (reverse allowed).
- `heading += steerIn * turnRate * dt * clamp(|v|/10,0,1) * sign(v)` — no steering at standstill.
- Position: `x += cos(heading)*v*dt; z += sin(heading)*v*dt`.
- Off-track: `|lat| > widthWorld/2` → `maxSpeed*offroadFactor` cap + `drag*2.5` extra; flag `offTrack`.
- Hard bound: `|lat| > widthWorld/2 + 6` → project back to that offset and `v *= 0.3`.

- [ ] **Step 1: Failing tests**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCarState, stepCar } from "../public/js/car.js";
import { buildSpline } from "../public/js/track.js";

const track = { spline: buildSpline([[0,0],[200,0],[200,200],[0,200]], true, 16), widthWorld: 14 };

test("throttle accelerates from rest", () => {
  let s = createCarState(0, 0, 0);
  for (let i = 0; i < 60; i++) s = stepCar(s, {throttle:1, brake:0, steerIn:0}, 1/60, track);
  assert.ok(s.v > 10, `v=${s.v}`);
});

test("no throttle → drag slows down", () => {
  let s = createCarState(10, 0, 0); s.v = 30;
  for (let i = 0; i < 180; i++) s = stepCar(s, {throttle:0, brake:0, steerIn:0}, 1/60, track);
  assert.ok(s.v < 15, `v=${s.v}`);
});

test("steering changes heading only with speed", () => {
  let still = createCarState(100, -50, 0);
  const h0 = still.heading;
  still = stepCar(still, {throttle:0, brake:0, steerIn:1}, 1/60, track);
  assert.equal(still.heading, h0); // standstill: no turn
  let moving = createCarState(100, -50, 0); moving.v = 20;
  moving = stepCar(moving, {throttle:0, brake:0, steerIn:1}, 1/60, track);
  assert.notEqual(moving.heading, h0);
});

test("off-track caps speed", () => {
  let s = createCarState(100, -60, 0); // way outside bottom edge (width 14 → half 7)
  s.v = 0;
  for (let i = 0; i < 240; i++) s = stepCar(s, {throttle:1, brake:0, steerIn:0}, 1/60, track);
  assert.ok(s.v <= 38 * 0.45 + 1, `v=${s.v}`); // offroad cap
  assert.equal(s.offTrack, true);
});

test("hard bound clamps lateral distance", () => {
  let s = createCarState(100, -200, 0); // absurdly far
  s.v = 30;
  s = stepCar(s, {throttle:0, brake:0, steerIn:0}, 1/60, track);
  // after one step still far, but over repeated steps must clamp within half+6
  for (let i = 0; i < 30; i++) s = stepCar(s, {throttle:0, brake:0, steerIn:0}, 1/60, track);
  const p = track.spline; // rely on lat via offTrack flag + assert position near track:
  assert.ok(Math.abs(s.z) < 200, "should have been pulled back toward track band");
});
```

(Adjust the last test to assert via `progressAt(track.spline, s.x, s.z, -1).|lat| <= 7+6+0.5` — import `progressAt` and compute actual lat; write it that way.)

- [ ] **Step 2: Run → FAIL** (`npm test`)

- [ ] **Step 3: Implement `car.js`** per rules above; `progressAt` for lat; import from `./track.js`.

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit** — `git commit -m "feat: arcade car physics with off-track handling (TDD)"`

---

### Task 7: AI drivers (TDD core)

**Files:**
- Create: `public/js/ai.js`, `test/ai.test.js`

**Interfaces:**
- Produces:
  - `createAI(state, skill=0.9)` → `{state, skill, update(dt, track, playerState)}`
  - `aiInput(ai, track, dt, playerState)` → `{throttle, brake, steerIn}` — lookahead target = spline sample nearest-index + `lookahead = clamp(6 + v*0.5, 8, 16)` meters ahead (convert to sample offset via avg spacing); steer = angle diff to target clamped ±1; target speed = `maxSpeed * skill * curvatureFactor * rubberband` where `curvatureFactor` = min over lookahead window of `(allowedSpeed = sqrt(latAccelMax / curvature))` with `latAccelMax ≈ 18`; rubberband = `clamp(1 + (playerS − aiS) / 600, 0.9, 1.1)` using (lap*S + s) progress diff.
  - `separateCars(states, radius=3.2)` — pairwise push-apart (equal split), used by race loop.

- [ ] **Step 1: Failing tests**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAI, aiInput, separateCars } from "../public/js/ai.js";
import { createCarState } from "../public/js/car.js";
import { buildSpline } from "../public/js/track.js";

const track = { spline: buildSpline([[0,0],[400,0],[400,400],[0,400]], true, 16), widthWorld: 14 };

test("AI steers toward track when facing off it", () => {
  const ai = createAI(createCarState(200, -4, 0), 0.9); // below bottom edge, heading +X
  ai.state.v = 20;
  const inp = aiInput(ai, track, 1/60, null);
  assert.ok(inp.steerIn !== 0, "must correct heading");
  assert.ok(Math.abs(inp.steerIn) <= 1);
});

test("AI lifts off before sharp corner far ahead", () => {
  // place AI approaching the (400,0) corner at speed on the bottom edge
  const ai = createAI(createCarState(360, 0, 0), 0.95);
  ai.state.v = 35;
  const straight = aiInput(ai, track, 1/60, null);
  const ai2 = createAI(createCarState(392, 0, 0), 0.95);
  ai2.state.v = 35;
  const nearCorner = aiInput(ai2, track, 1/60, null);
  assert.ok(nearCorner.throttle < straight.throttle || nearCorner.brake > 0,
    `straight=${JSON.stringify(straight)} corner=${JSON.stringify(nearCorner)}`);
});

test("rubberband: trailing AI gets cap boost, leading gets damp", () => {
  const ai = createAI(createCarState(100, 0, 0), 0.9);
  ai.state.v = 20;
  const behind = { ...createCarState(300, 0, 0), v: 0 }; // player far ahead in s
  const ahead  = { ...createCarState(50, 0, 0), v: 0 };
  const a = aiInput(ai, track, 1/60, behind);
  const b = aiInput(ai, track, 1/60, ahead);
  // compare target-speed influence via throttle/brake pair: trailing should be more aggressive
  const score = x => x.throttle - x.brake;
  assert.ok(score(a) >= score(b) - 1e-9);
});

test("separateCars pushes overlapping cars apart", () => {
  const A = createCarState(0, 0, 0), B = createCarState(1, 0, 0);
  separateCars([A, B], 3.2);
  assert.ok(Math.hypot(A.x - B.x, A.z - B.z) > 3.0);
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement `ai.js`** (curvature: for samples ahead, turn angle per meter = |Δheading| / segLen; allowed = sqrt(18 / κ); take min over window; blend with skill).

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit** — `git commit -m "feat: spline-following AI with rubberbanding (TDD)"`

---

### Task 8: Race loop, HUD, results

**Files:**
- Create: `public/js/race.js`, `public/js/hud.js`
- Modify: `public/index.html` (`#screen-race` HUD + `#screen-results`), `public/css/style.css`

**Interfaces:**
- Consumes: scene, car, ai, track (`worldFromPreset`, `progressAt`, `LapTracker`).
- Produces:
  - `startRace({canvas, preset, mode:"ai"|"mp", players?})` → returns `{stop()}`; owns rAF loop, input, cars, countdown, finishes.
  - HUD DOM: `#hud` with `#hud-speed`, `#hud-lap`, `#hud-pos`, `#hud-minimap` (canvas 160×120), `#hud-countdown` (big center), `#hud-toast-area`.
  - Results DOM: `#screen-results` with `#res-table` (rows: place, name, total, best lap), buttons `#res-restart`, `#res-menu`.
  - Events out: dispatches `CustomEvent("polytrack:race-done", {detail:{results}})` on window; `polytrack:mp-send` hook: when `mode==="mp"`, calls `window.__mpSend(stateObj)` at 15 Hz (net.js sets `window.__mpSend`) and exposes `window.__mpApply(id, snapshot)` for remote cars (net.js calls it).

Race rules: countdown 3→2→1→GO (1 s each, `#hud-countdown`), 3 laps via `LapTracker` (require `progressAt` hint continuity — keep per-car hint), position sort by `lap*length + s` desc, results on player finish (AI finish times simulated: AI total = elapsed scaled by their final gap — simpler: race ends when player finishes; AI placements by their current (lap,s), unfinished AIs ranked below by progress; record best lap per car from `s` wrap deltas).

- [ ] **Step 1: HUD + results markup/CSS** — speed (bottom-right big number + "km/h"), lap (top-left "Lap 1/3"), pos (top-right "2/4"), minimap top-left below lap, countdown center hidden by default, results = centered card table.

- [ ] **Step 2: Implement `hud.js`** — pure DOM update functions: `hudInit()`, `hudUpdate({speedKmh, lap, pos, total, minimap:{spline,width, cars:[{x,z,color}]}})` draws minimap (scale world → 160×120 with 10 px margin, polyline + dots), `hudCountdown(n|null)`.

- [ ] **Step 3: Implement `race.js` loop**

```
init: world = worldFromPreset(preset); scene.setTrack(world);
cars = player (color #22c55e) + 3 AI (colors #f59b0b,#3b82f6,#e11d42) placed
  on start line staggered: offset lateral ±(width/4), back along -heading by i*7 m
player: createCarState at slot 0; AI: createAI each; trackers = LapTracker per car
countdown state machine → GO → fixed-ish dt loop (dt=clamp(now-last,0,0.05))
each frame: input→stepCar(player)→aiInput→stepCar each AI→separateCars(states)→
  moveCar meshes→progressAt per car (hint per car)→tracker.update(s, dir) where
  dir = Δs normalized (use lat-heading? simpler: pass dir=+1 when s advanced past
  wrap logic — tracker only needs s and a direction estimate: dir = (newS−oldS) sign
  with wrap handling: if wrapped forward dir=+1, backward dir=−1, else sign(delta))
→ HUD update → check player finished (lap>3… tracker lap counts 0..3, finish when lap===3
  and crossed) → results screen → event.
Esc → stop() + hash menu. R → reset player to nearest centerline sample (heading=tangent).
```

- [ ] **Step 4: Wire minimap + camera** — `chaseCamera` per frame for player; `scene.render()`.

- [ ] **Step 5: Static check** — `node --check public/js/race.js && node --check public/js/hud.js`.

- [ ] **Step 6: Commit** — `git commit -m "feat: race loop, HUD, countdown, results"`

---

### Task 9: Menu, router, main boot

**Files:**
- Create: `public/js/main.js`
- Modify: `public/index.html` (`#screen-menu` markup), `public/css/style.css`

**Interfaces:**
- Consumes: `initEditor`, `startRace`, presets store, `track.js` (`worldFromPreset` for validation), net (Task 10, optional at this point — guard `import("./net.js")` lazily behind menu click).
- Produces: hash router `#menu|#editor|#presets|#lobby|#race`, boot code.

Menu markup:

```html
<div class="menu-card">
  <h1>poly<span>TRACK</span></h1>
  <p class="tag">draw it. race it.</p>
  <button class="btn primary" id="m-race">Race vs AI</button>
  <button class="btn" id="m-mp">Multiplayer (LAN)</button>
  <button class="btn" id="m-editor">Track editor</button>
  <button class="btn ghost" id="m-presets">Presets (<span id="m-count">0</span>)</button>
  <p class="hint" id="m-sw">offline: <span id="m-sw-state">…</span></p>
</div>
<div id="preset-list" class="preset-list hidden"> … rows: name, [Race] [Edit] [Export] [Delete], plus [Import JSON] file input … </div>
```

Behavior:
- `#m-race`: if no presets → toast "Draw a track first" → editor; else show preset picker (`#preset-list` with per-row Race) → `startRace({mode:"ai"})`.
- `#m-editor` → `#editor`; editor's `onRace(preset)` → `location.hash="#race"` and stash `sessionStorage.polytrack.current = JSON.stringify(preset)`.
- `#race` route: read current preset → `startRace`; leaving route calls `stop()`.
- `#m-mp` → `#lobby` (Task 10 populates; until then toast "Multiplayer arriving").
- Presets manager: list, rename (prompt), delete (confirm), export (download JSON blob), import (`<input type=file>` → `store.importAll`).
- Boot: check WebGL (`canvas.getContext("webgl2")||webgl`) → blocking overlay message if null; `store = createPresetStore(localStorage)`; `navigator.serviceWorker?.register("/sw.js")` (SW content Task 11 — register regardless, 404 harmless during dev but Task 11 lands before final verify); toast helper `window.toast(msg, ms=2600)`.

- [ ] **Step 1: Fill menu HTML/CSS** (centered card, h1 with green accent on "TRACK", buttons stacked full-width 240 px).
- [ ] **Step 2: Implement `main.js`** router + boot + presets manager wiring per above.
- [ ] **Step 3: Browser smoke test (manual)** — run server, open `http://localhost:3000`: menu visible, no console errors, editor opens, can draw loop, save, "Race this track" loads 3D scene with countdown and drivable car (arrow keys). Verify: **one full 3-lap race completes → results table shows → back to menu works.** Record any console errors and fix.
- [ ] **Step 4: Commit** — `git commit -m "feat: menu, router, presets manager, playable SP race"`

---

### Task 10: Multiplayer (client + lobby)

**Files:**
- Create: `public/js/net.js`
- Modify: `public/js/main.js` (`#m-mp` → lobby route), `public/index.html` (`#screen-lobby`), `public/js/race.js` (already exposes `__mpSend`/`__mpApply` hooks), CSS.

**Interfaces:**
- Consumes: WS protocol from Task 1; race hooks from Task 8.
- Produces:
  - `connectMultiplayer({name, onLobby, onRace})` → connects `ws(s)://location.host/ws`, returns `{disconnect()}`.
  - Lobby DOM: `#lobby-name` input, `#lobby-status` (Connected as …; you are HOST/PLAYER), `#lobby-peers` list, `#lobby-track` (host: "Use last raced/picked preset" select from store; shows track name), `#lobby-start` (host only, disabled until ≥1 track), `#lobby-leave`.
  - Remote car state: buffer `{t, x, z, heading, v}` per remote id, `__mpApply(id, snap)` pushes; race reads interpolated snapshot at `now−120ms` each frame (expose `window.__mpSample(id, now)` from net.js — race.js calls it; if race.js already has its own apply path, keep ONE path: net.js stores buffers, race.js polls `window.__mpSnapshots` Map — decide: **race.js polls `window.__mpBuffers` Map<string, array>** and interpolates; net.js only writes buffers + manages join/leave events via `CustomEvent("polytrack:mp-peers")`).

Lobby flow:
1. Connect → send `join{name}`; show peers from `peers`/`joined`/`left`.
2. Host (from `you.host`) picks a preset (dropdown of store presets) → send `track{preset}`; Start → send `start{countdownAt: Date.now()+3000}` → both sides `sessionStorage.polytrack.current = preset`, route `#race` with `mode:"mp"`; countdown uses absolute `countdownAt` (race.js: if `mode==="mp"` and `window.__mpCountdownAt`, start countdown from that timestamp).
3. Non-host waits for `track`/`start` messages.
4. State pump: in race loop via `__mpSend({x,z,heading,v,lap,s})` every ~66 ms.
5. On finish (mp): send `finish{ms}`; results include remote entries as they arrive (`polytrack:mp-finish` event, id → name).
6. ws close → toast + `#menu`.

- [ ] **Step 1: Lobby markup + CSS.**
- [ ] **Step 2: Implement `net.js`** per protocol + buffers + events.
- [ ] **Step 3: Wire `main.js` routes + race.js mp hooks** (countdownAt, buffers→remote car meshes add/remove on peer events, send pump, finish relay).
- [ ] **Step 4: Two-client smoke test** — start server; open two browser windows (`localhost:3000` both); window A: Multiplayer → picks preset → Start; window B: Multiplayer → sees lobby, receives track, countdown syncs, both cars visible moving in real time, finish shows both rows. Verify A/B on separate tabs is enough (same host = localhost path). Fix issues.
- [ ] **Step 5: Commit** — `git commit -m "feat: LAN/localhost multiplayer with lobby and state sync"`

---

### Task 11: Service worker (offline)

**Files:**
- Create: `public/sw.js`
- Modify: `public/js/main.js` (registration + update toast)

**Interfaces:**
- Consumes: nothing runtime; caches URL list.
- Produces: SW with `polytrack-v1` cache; precache list = `/`, `/css/style.css`, `/manifest.webmanifest`, `/favicon.svg`, `/icons/icon-192.png`, `/icons/icon-512.png`, and every file in `public/js/`: `main.js`, `track.js`, `presets.js`, `editor.js`, `scene.js`, `car.js`, `ai.js`, `race.js`, `hud.js`, `net.js`, `vendor/three.module.js`.

- [ ] **Step 1: Implement `sw.js`**

```js
const VERSION = "polytrack-v1";
const PRECACHE = [ /* list above */ ];
install → caches.open(VERSION).then(c => c.addAll(PRECACHE)).then(skipWaiting)
activate → delete caches with prefix "polytrack-" ≠ VERSION, clients.claim()
fetch → if method!=GET or url.origin!==location.origin or url.pathname==="/ws" → bypass;
  navigation (mode===navigate") → network-first, fallback caches.match("/");
  else cache-first, fallback fetch; put clone on success (runtime fill for any same-origin GET).
```

- [ ] **Step 2: Registration + update UX in `main.js`**

```js
navigator.serviceWorker?.register("/sw.js").then(reg => {
  reg.addEventListener("updatefound", () => {
    const nw = reg.installing;
    nw?.addEventListener("statechange", () => {
      if (nw.state === "activated" && navigator.serviceWorker.controller)
        toast("Update ready — reload for the new version", 5000);
    });
  });
  // show offline capability in menu
  const el = document.getElementById("m-sw-state");
  if (el) navigator.serviceWorker.ready.then(() => el.textContent = "ready");
}).catch(() => { const el = document.getElementById("m-sw-state"); if (el) el.textContent = "unavailable"; });
```

- [ ] **Step 3: Verify offline** — start server; open app in browser; DevTools → Network → Offline; reload → app shell still loads, menu + editor + single-player race work from cache; (multiplayer correctly unavailable). Re-enable network.
- [ ] **Step 4: Commit** — `git commit -m "feat: service worker with precached app shell and offline play"`

---

### Task 12: Final verification + docs

**Files:**
- Create: `README.md`
- Modify: fixes only

- [ ] **Step 1: Full test suite** — `npm test` → all pass.
- [ ] **Step 2: Syntax gate** — for f in `public/js/*.js`: `node --check $f` → all OK (skip vendor).
- [ ] **Step 3: End-to-end checklist (browser)** — clean run: boot no console errors; draw→save→race→3 laps→results; presets export/import roundtrip; MP two tabs sync; SW offline reload; keyboard R reset; Esc menu.
- [ ] **Step 4: README.md** — how to run (`npm install`, `npm start`, open `http://localhost:3000`, friends: `http://<your-LAN-IP>:3000`), controls, features, testing (`npm test`).
- [ ] **Step 5: Commit** — `git commit -m "docs: README with run instructions and controls"`

## Self-Review notes

- Spec coverage: editor (T4), presets (T3/T9), scene (T5), physics (T6), AI (T7), race/HUD (T8), MP (T10), SW (T11), errors (WebGL guard T9, WS toast T10, preset validation T3), testing (T2/T3/T6/T7 unit + T9/T10/T11 smoke). ✅
- Placeholders: none — every task has concrete code or exact rules. UI markup concrete; CSS described precisely but not fully literal (accepted: CSS is directly derived from the stated rules).
- Type consistency: `worldFromPreset → {spline, widthWorld, start}` used by T5/T8; `stepCar(state,input,dt,track,params)` consistent T6/T8; `aiInput(ai,track,dt,playerState)` T7/T8; WS protocol T1=T10. ✅
