# polyTRACK — Design Spec

A 3D low-poly racing game: draw a track, race it against AI or over localhost/LAN with friends. Offline-capable via service worker.

## Goals

- Draw a closed track freehand, edit control points, tune width/smoothing, save named presets.
- Race in 3D on the drawn track: arcade physics, 3 laps, live positions, lap times.
- Single-player vs 3 AI opponents, or real-time multiplayer on localhost/LAN.
- Full offline support for editor and single-player (service worker precache).
- Zero build step: plain ES modules + vendored Three.js, run with `node server.js`.

## Non-Goals

- Internet-wide multiplayer / matchmaking / persistence servers.
- Account systems, leaderboards beyond local session.
- Asset store, complex car customization, audio (v1 is silent — no engine sounds).
- Mobile-first layout (should not crash, but desktop keyboard is the primary input).

## Architecture

```
Browser (ES modules, no bundler)
├── main.js        screen router (menu / editor / race / results), boot, SW registration
├── track.js       pure geometry: resample, Chaikin smoothing, closed Catmull-Rom
│                  spline, arc-length table, lateral distance, road mesh builder input
├── presets.js     localStorage CRUD + JSON export/import
├── editor.js      2D canvas: freehand capture, drag points, sliders, live preview
├── scene.js       Three.js scene: road/curb/startline meshes, ground, props, lights, fog
├── car.js         arcade physics: throttle/brake/steer, drift, off-track slowdown
├── ai.js          spline-follower AI with curvature-based speed + rubber-banding
├── race.js        countdown, checkpoint lap validation, positions, timing, results
├── net.js         WebSocket client: join, state broadcast, remote car interpolation
├── hud.js         speed / lap / position / minimap / toasts
└── vendor/three.module.js   vendored Three.js (precached by SW)

server.js (Node, deps: ws)
├── static file server for ./public (correct MIME types)
└── WebSocket relay: id assignment, host = first joiner, track preset broadcast,
    15 Hz state fan-out, join/leave, countdown signal, finish notifications
```

### Data model

**TrackPreset** (JSON, stored in `localStorage.polytrack.presets`):

```json
{
  "id": "uuid",
  "name": "My Circuit",
  "points": [[x, y], ...],   // 2D control points, editor canvas coords, closed loop
  "width": 14,               // road width, world units (1 unit = 1 m)
  "smoothing": 2,            // Chaikin iterations 0..4
  "createdAt": 1728000000
}
```

World mapping: editor coords are normalized (fit to canvas), then scaled so the
track bounding box fits a ~180 m field; Y in editor = Z in world (X right, Z down/up).

### Track geometry pipeline

1. `points` → Chaikin smoothing (N iterations) → resample to evenly spaced polyline (~2 m).
2. Closed Catmull-Rom through resampled points → sample at high density (S segments).
3. Precompute cumulative arc-length table → `sAt(i)`, total length L.
4. Car progress = arc-length position of nearest centerline sample (with temporal
   continuity: search near last known index to avoid jumps on parallel sections).
5. Lap = progress wraps past L *and* checkpoint (s near 0) was crossed since last wrap;
   reject backward wrap (reverse driving).

### Road mesh

- Ribbon: left/right offsets (±width/2 + 1.5 m shoulder) per sample → BufferGeometry,
  vertex-colored asphalt with start-line stripe quad at s=0.
- Curbs: red/white alternating boxes along both edges.
- Ground: large low-poly plane (flat green, slight vertex jitter), random low-poly
  trees/cones/buildings placed ≥ 8 m from track edge, deterministic seed per preset id.
- Sky: hemisphere light + directional (shadows on), fog for depth.

### Car physics (arcade)

- State: pos (x,z), heading θ, speed v.
- Input: throttle/brake → accelerate along heading; steering → θ scales with speed
  (reduced at high speed); lateral grip: velocity bleeds toward heading (drift factor).
- Off-track (lateral distance > width/2): max speed cut to ~45%, extra drag, camera shake.
- Wall rule: beyond width/2 + 6 m → clamp and kill speed (soft boundary, no wall mesh).

### AI

- Follows centerline with lookahead (8–14 m scaled by speed), steer = angle to lookahead.
- Target speed = f(curvature ahead): slower in turns, capped at max.
- Rubber-band: ±10% max speed by distance to player (keeps races close, not fake-feeling).
- Same collision/off-track rules as player; simple car-car push apart (circle collision).

### Race rules

- 3 laps (constant), 3-2-1-GO countdown (also gates multiplayer start).
- Positions sorted by (lap, progress) desc.
- Results screen: placement, total time, best lap; race again / back to menu.
- Minimap HUD: downscaled centerline + car dots.

### Multiplayer (localhost/LAN)

- `node server.js` → serves app on `0.0.0.0:3000`; others join via `http://<lan-ip>:3000`.
- Single global room. First connector = host: picks preset from their localStorage,
  presses Start → server broadcasts `{t:"start", preset, countdownAt}`.
- Clients send `{t:"state", x, z, heading, v, lap, s}` at 15 Hz; server fans out to peers.
- Remote cars: sample-buffer interpolation (~120 ms behind) for smoothness.
- Client-authoritative lap times (friends-trust-friends scope); server relays `finish`.
- Disconnect → remote car removed; ws close → toast + return to menu.

### Service worker

- Precache app shell: html, css, all first-party js, vendor/three, manifest, icons.
- Cache-first for hashed/static assets, network-first (fallback cache) for HTML nav.
- `/ws` upgrade and API-ish requests bypass SW. Versioned cache name, old caches purged
  on activate. Registered on load; `updatefound` toast → "Reload to update".

### Screens & flow

```
Menu ──▶ Editor ──▶ Save preset ──▶ Race vs AI (pick preset, 3 AI) ──▶ Results
  │                    │                        ▲
  │                    └──▶ [Multiplayer] ──▶ lobby (name, wait/ready) ──▶ race ──▶ results
  └──▶ Presets manager (load / rename / delete / export / import)
```

- Keyboard: ↑/W throttle, ↓/S brake/reverse, ←/→ or A/D steer, R reset to track, Esc menu.
- Editor: hold mouse to draw; click point to select, drag to move; double-click track to
  add point; sliders for width (8–24) and smoothing (0–4); buttons New/Save/Clear/Race.

### Error handling

- WebGL unavailable → menu shows blocking message with browser suggestion.
- Preset import: JSON schema check (points array ≥ 4, finite numbers) → toast on reject.
- WS failure: toast with retry; single-player unaffected.
- SW registration failure: game still runs (SW is enhancement only).

## Testing

- **Unit (node:test, no DOM):** `track.js` pure functions — Chaikin count/stability,
  resample spacing, arc-length monotonicity, nearest-sample progress, lap wrap +
  checkpoint logic (forward cross = lap, reverse = none, mid-track U-turn = none).
- **Smoke (manual/playwright):** server boots, menu renders with no console errors,
  editor produces a preset, race screen loads 3D scene, SW registers.

## Risks / tradeoffs

- Self-intersecting drawn tracks: lap logic still works (nearest-sample + checkpoint),
  but visuals overlap — editor shows a warning, not a blocker.
- Client-authoritative multiplayer: fine for LAN friends; not cheat-proof (accepted).
- No bundler: import map or relative `.js` extensions everywhere (chosen: explicit
  extensions, simplest).
