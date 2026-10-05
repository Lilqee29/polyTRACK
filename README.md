# polyTRACK

Draw a track with your mouse, then race it against three AI opponents or over LAN/localhost multiplayer. Low-poly arcade racing that runs entirely in the browser — no build step.

> status: v2.0.0 · 51 unit tests passing · browser smoke-tested (single-player, 2-client multiplayer, offline, official-track/theme/elevation flows)

## Features

- **Official tracks** — 30 built-in tracks (10 per theme, flat/rolling/alpine mixes, difficulty stars, figure-eights) that need no saved presets; race them directly or hit **Edit** to fork one into your own copy (`public/js/library.js`).
- **Themes** — Summer, Winter, and Desert palettes: sky, fog, ground, road/shoulder/skirt colors, and per-theme props (trees + buildings / snow-capped pines / cacti + rocks), plus per-theme driving mods (grip/acceleration/off-road drag) (`public/js/scene.js`, `public/js/race.js`).
- **Elevation** — every track gets roller-coaster hills from a seeded profile: continuous grades feed the physics (climbs slow you down, descents let you overspeed), crests launch you into airtime with a landing nudge, and roads get side skirts that close the gap to the ground (`public/js/track.js`, `public/js/car.js`).
- **Track editor** — click/sketch points on a 2D canvas, drag dots to adjust, tune width (m), smoothing iterations, **theme**, and **hills** (0–30 m amplitude), save as a named preset; the canvas previews the true spline pipeline, not just the chaikin curve (`public/js/editor.js`).
- **Presets** — saved to `localStorage`, re-editable, exportable/importable as JSON; schema v2 carries `theme` and `elev` with validated defaults (`public/js/presets.js`).
- **Race vs AI** — 3 spline-following opponents with skill levels, corner-speed braking, uphill caution, car separation, and mild rubberbanding (`public/js/ai.js`).
- **Arcade physics** — acceleration, braking, reverse, steering smoothing, extra drag off-track, soft/wall bounds, plus grade forces and airtime (`public/js/car.js`).
- **Race flow** — 3-2-1-GO countdown, 3 laps with lap-tracking that forgives wrong-way line crossings, live HUD (speed, lap, position, minimap), results table (`public/js/race.js`, `public/js/hud.js`).
- **Multiplayer (LAN)** — WebSocket lobby: set your name, the host picks any track (official or saved) and starts, everyone gets the synced countdown; positions relayed with interpolation; remote finishes show in results (`public/js/net.js`, `server.js`).
- **Offline** — a service worker precaches all 19 core assets with stale-while-revalidate, so the menu and a full AI race work with the network cut (`public/sw.js`). Multiplayer fails gracefully with a toast.

## Requirements

- Node.js 18+ (uses `node --test`; developed and verified on Node v24)
- npm
- A desktop browser with WebGL and ES-module support

## Install & run

```sh
npm install
npm start
```

Then open http://localhost:3000

The server serves `public/` with `no-cache` headers and listens on `0.0.0.0`, so other devices on your network can join multiplayer at `http://<your-ip>:3000`.

## Configuration

| Variable | Default | Source |
|----------|---------|--------|
| `PORT`   | `3000`  | `server.js` — `process.env.PORT ? Number(process.env.PORT) : 3000` |

Example (PowerShell): `$env:PORT=8080; npm start`

That is the only environment variable in the project.

## Controls

| Input | Action |
|-------|--------|
| `↑` / `W` | Accelerate |
| `↓` / `S` | Brake / reverse |
| `←` `→` / `A` `D` | Steer |
| `R` | Reset car to the track (`race.js`: projects you back onto the nearest spline point) |
| `Esc` | Quit race to menu (`race.js`: `if (e.key === "Escape") location.hash = "#menu"`) |

## Multiplayer how-to

1. Start the server, open the menu on each machine → **Multiplayer (LAN)**.
2. Set a name in the lobby; the peer list updates live. The first client connected is the host.
3. The host picks a track (official library or one of your saved presets) and presses **Start**.
4. All clients jump into the race with a synced countdown. Positions relay over the same WebSocket (`/ws`), ~15 Hz, rendered through a short interpolation buffer.

Protocol message types (from `server.js`): `you`, `joined`, `peers`, `left`, `join`, `state`, `relay`, `track`, `start`, `finish`.

## Tests

```sh
npm test
```

Runs `node --test` over `test/`:

| File | Covers |
|------|--------|
| `test/track.test.js` | Chaikin smoothing, even resampling (no seam bunching), spline progress, lap tracking, elevation profiles (seam, determinism), height/grade sampling, world fitting |
| `test/presets.test.js` | Preset validation, schema v2 (`theme`/`elev` defaults, normalization, export round-trip), localStorage store behaviour |
| `test/car.test.js` | Physics: acceleration, drag, off-track penalty, bounds, steering input, grade forces, airtime launch/flight/landing, height-aware camera |
| `test/ai.test.js` | Spline lookahead steering, curvature-limited target speed, uphill caution, rubberbanding |
| `test/library.test.js` | Official library: 30 frozen tracks, per-theme/difficulty mixes, every track validates and builds a drivable world |

Browser smoke tests (Playwright-driven, outside this repo) additionally verify: full menu→editor→race flow, official-tracks UI (badges, edit-to-copy, theme/hills persistence), lobby track groups, themed/elevated official-track races driven end-to-end, 2-client lobby/relay/finish sync, and offline reload with the service worker.

## Architecture

No framework, no bundler — plain ES modules loaded directly by the browser.

```
server.js                 node:http + ws — static file server + WebSocket relay (/ws)
public/
  index.html              all screens (menu, editor, lobby, race, results) in one page
  css/style.css           dark arcade styling
  sw.js                   service worker: 19-asset precache, stale-while-revalidate
  js/
    main.js               hash router, menu, preset manager (official + saved), SW registration
    editor.js             2D canvas track drawing/editing + theme/hills controls
    presets.js            schema v2 validation (points/width/smoothing/theme/elev) + localStorage store
    library.js            30 frozen official presets (10 per theme, difficulty/shape metadata)
    track.js              Chaikin spline, resampling, elevation profile, heightAt/gradeAt, progress, LapTracker
    scene.js              three.js: themed road/curbs/skirts/ground/props, cars, minimap world
    car.js                arcade physics (grade + airtime) + chase camera
    ai.js                 opponent controller (corner + uphill speed management)
    race.js               game loop, theme driving mods, countdown, standings, results
    hud.js                speed/lap/position/minimap/countdown overlays
    net.js                WebSocket lobby + state buffers (window.__mp contract)
    vendor/three.module.js  vendored three.js (no CDN, works offline)
test/                     node:test unit tests
docs/superpowers/         design specs for v1 and v2
```

Key data flow: preset (official `library.js` or editor → `localStorage`) → `normalizePreset` (`presets.js`) → `worldFromPreset` (`track.js`, adds `H`/`G` elevation arrays) → scene (themed, skirting) + AI sampling + lap tracking. Multiplayer adds: `net.js` buffers → `race.js` interpolation → remote car meshes.

## Gaps

- **No LICENSE** — none in the repo; add one before publishing.
- **No CONTRIBUTING / CI** — single-author project; `npm test` is the only gate.
- **No `engines` field** in `package.json` — requirement stated above is from observed tooling (`node --test`, Node v24).
- **Vertical loops / wall-rides are out of scope** — elevation is hill-profile based (grades + airtime), not full loop-the-loop geometry.
- Audio is intentionally out of scope.
