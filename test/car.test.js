import { test } from "node:test";
import assert from "node:assert/strict";
import { createCarState, stepCar, chaseCamera, keyInput } from "../public/js/car.js";
import {
  buildSpline,
  resampleEven,
  progressAt,
  worldFromPreset,
} from "../public/js/track.js";

const sq = [
  [0, 0],
  [200, 0],
  [200, 200],
  [0, 200],
];
const track = {
  spline: buildSpline(resampleEven(sq, 2, true), true, 8),
  widthWorld: 14,
};

test("throttle accelerates from rest", () => {
  let s = createCarState(0, 0, 0);
  for (let i = 0; i < 60; i++) s = stepCar(s, { throttle: 1, brake: 0, steerIn: 0 }, 1 / 60, track);
  assert.ok(s.v > 10, `v=${s.v}`);
  assert.equal(s.offTrack, false);
});

test("no throttle → drag slows down", () => {
  let s = createCarState(10, 0, 0);
  s.v = 30;
  for (let i = 0; i < 180; i++) s = stepCar(s, { throttle: 0, brake: 0, steerIn: 0 }, 1 / 60, track);
  assert.ok(s.v < 15, `v=${s.v}`);
});

test("steering changes heading only when moving", () => {
  let still = createCarState(100, 0, 0);
  const h0 = still.heading;
  still = stepCar(still, { throttle: 0, brake: 0, steerIn: 1 }, 1 / 60, track);
  assert.equal(still.heading, h0);
  let moving = createCarState(100, 0, 0);
  moving.v = 20;
  moving = stepCar(moving, { throttle: 0, brake: 0, steerIn: 1 }, 1 / 60, track);
  assert.notEqual(moving.heading, h0);
});

test("off-track caps speed and sets flag", () => {
  let s = createCarState(100, -60, 0);
  s.v = 0;
  for (let i = 0; i < 240; i++) s = stepCar(s, { throttle: 1, brake: 0, steerIn: 0 }, 1 / 60, track);
  assert.ok(s.v <= 38 * 0.45 + 1, `v=${s.v}`);
  assert.equal(s.offTrack, true);
});

test("hard bound pulls car back within half+6 of track", () => {
  let s = createCarState(100, -200, 0);
  s.v = 30;
  for (let i = 0; i < 30; i++) s = stepCar(s, { throttle: 0, brake: 0, steerIn: 0 }, 1 / 60, track);
  const p = progressAt(track.spline, s.x, s.z, -1);
  assert.ok(Math.abs(p.lat) <= 7 + 6 + 0.5, `lat=${p.lat}`);
});

test("brake stops forward motion", () => {
  let s = createCarState(50, 0, 0);
  s.v = 25;
  for (let i = 0; i < 180; i++) s = stepCar(s, { throttle: 0, brake: 1, steerIn: 0 }, 1 / 60, track);
  assert.ok(Math.abs(s.v) < 3, `v=${s.v}`);
});

test("keyInput maps WASD + arrows", () => {
  const keys = new Set(["w", "ArrowRight"]);
  const inp = keyInput(keys);
  assert.equal(inp.throttle, 1);
  assert.equal(inp.steerIn, 1); // right = heading increases (toward +Z)
  const idle = keyInput(new Set());
  assert.deepEqual(idle, { throttle: 0, brake: 0, steerIn: 0 });
});

test("chaseCamera follows behind car", () => {
  const cam = { position: { x: 0, y: 0, z: 0 }, calls: 0, lookAt() { this.calls++; } };
  const car = { x: 100, z: 0, heading: 0 }; // facing +X — camera behind = x-10
  for (let i = 0; i < 400; i++) chaseCamera(cam, car, 1 / 60);
  assert.ok(Math.abs(cam.position.x - 90) < 1, `x=${cam.position.x}`);
  assert.ok(Math.abs(cam.position.z - 0) < 1, `z=${cam.position.z}`);
  assert.ok(cam.position.y > 3 && cam.position.y < 6, `y=${cam.position.y}`);
  assert.ok(cam.calls > 0);
});

test("createCarState carries vertical state", () => {
  const s = createCarState(0, 0, 0);
  assert.equal(s.y, 0);
  assert.equal(s.air, false);
  assert.equal(s.vy, 0);
  assert.equal(s.airT, 0);
});

test("flat world: car glues to y=0, never launches", () => {
  const w = worldFromPreset({ points: sq, width: 14, smoothing: 2 });
  let s = createCarState(w.start.x, w.start.z, w.start.heading);
  s.v = 30;
  for (let i = 0; i < 120; i++) {
    s = stepCar(s, { throttle: 1, brake: 0, steerIn: 0 }, 1 / 60, w);
  }
  assert.equal(s.air, false);
  assert.equal(s.y, 0);
});

test("grade physics: uphill loses exactly gradeK*g*dt vs flat control", () => {
  const w = worldFromPreset({ points: sq, width: 14, smoothing: 2, elev: { amp: 30, seed: 13 } });
  const flat = worldFromPreset({ points: sq, width: 14, smoothing: 2 });
  let gi = 0;
  for (let i = 0; i < w.G.length; i++) if (w.G[i] > w.G[gi]) gi = i;
  const g = w.G[gi];
  assert.ok(g > 0.1, `need a real uphill, g=${g}`);
  const p0 = w.spline.pts[gi];
  const p1 = w.spline.pts[(gi + 1) % w.G.length];
  const heading = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
  const run = (world) => {
    const s = createCarState(p0[0], p0[1], heading);
    s.v = 20;
    s.hint = gi;
    return stepCar(s, { throttle: 0, brake: 0, steerIn: 0 }, 0.1, world).v;
  };
  const vh = run(w);
  const vf = run(flat);
  assert.ok(Math.abs(vf - vh - 9 * g * 0.1) < 1e-9, `vf=${vf} vh=${vh} g=${g}`);
});

test("downhill: overspeed allowed above base cap", () => {
  const w = worldFromPreset({ points: sq, width: 14, smoothing: 2, elev: { amp: 30, seed: 13 } });
  let di = 0;
  for (let i = 0; i < w.G.length; i++) if (w.G[i] < w.G[di]) di = i;
  const g = w.G[di];
  assert.ok(g < -0.05, `need a real downhill, g=${g}`);
  const p0 = w.spline.pts[di];
  const p1 = w.spline.pts[(di + 1) % w.G.length];
  const heading = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
  const s = createCarState(p0[0], p0[1], heading);
  s.v = 38;
  s.hint = di;
  const out = stepCar(s, { throttle: 1, brake: 0, steerIn: 0 }, 0.1, w);
  const afterThrottle = 38 + 22 * 0.1;
  const expected = afterThrottle - 0.6 * afterThrottle * 0.1 + 9 * -g * 0.1;
  assert.ok(Math.abs(out.v - expected) < 1e-9, `v=${out.v} expected=${expected}`);
  assert.ok(out.v > 38, `overspeed expected, v=${out.v}`);
});

test("airtime: crest launch, flight, landing", () => {
  const w = worldFromPreset({ points: sq, width: 14, smoothing: 2 });
  const n = w.H.length;
  const cum = w.spline.cum;
  const idxAt = (m) => {
    let i = 0;
    while (i < n - 1 && cum[i + 1] <= m) i++;
    return i;
  };
  const a = idxAt(100);
  const b = idxAt(140);
  const c = idxAt(200);
  for (let i = 0; i < n; i++) {
    w.H[i] = 0;
    w.G[i] = 0;
  }
  for (let i = a; i <= b; i++) w.H[i] = 0.3 * (cum[i] - cum[a]);
  for (let i = a; i < b; i++) w.G[i] = 0.3;
  const crest = w.H[b];
  for (let i = b; i <= c; i++) w.H[i] = crest - 0.4 * (cum[i] - cum[b]);
  for (let i = b; i < c; i++) w.G[i] = -0.4;
  for (let i = c; i < n; i++) w.H[i] = w.H[c];

  const i0 = b - 4; // uphill with the crest ~1.6m ahead: stays uphill after the move
  const p0 = w.spline.pts[i0];
  const p1 = w.spline.pts[(i0 + 1) % n];
  const heading = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
  let s = createCarState(p0[0], p0[1], heading);
  s.v = 20;
  s.hint = i0;
  s = stepCar(s, { throttle: 0, brake: 0, steerIn: 0 }, 1 / 60, w);
  assert.equal(s.air, true, "must launch at the crest");
  assert.ok(Math.abs(s.vy - 6) < 0.2, `vy=${s.vy}`);
  let maxAirT = 0;
  for (let i = 0; i < 400 && s.air; i++) {
    s = stepCar(s, { throttle: 0, brake: 0, steerIn: 0 }, 1 / 60, w);
    maxAirT = Math.max(maxAirT, s.airT);
  }
  assert.equal(s.air, false, "must land");
  assert.ok(maxAirT <= 1.5 + 1 / 60 + 1e-9, `forced landing by 1.5s, airT=${maxAirT}`);
  assert.ok(Number.isFinite(s.y));
});

test("chaseCamera follows car height", () => {
  const cam = {
    position: { x: 0, y: 0, z: 0 },
    seen: null,
    lookAt(x, y, z) {
      this.seen = [x, y, z];
    },
  };
  const car = { x: 10, z: 0, y: 8, heading: 0 };
  for (let i = 0; i < 400; i++) chaseCamera(cam, car, 1 / 30);
  assert.ok(Math.abs(cam.position.y - 12.8) < 0.05, `y=${cam.position.y}`);
  assert.ok(Math.abs(cam.seen[1] - 9.2) < 1e-6, `lookAt y=${cam.seen[1]}`);
});
