import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chaikinClosed,
  resampleEven,
  buildSpline,
  nearestIndex,
  progressAt,
  LapTracker,
  worldFromPreset,
} from "../public/js/track.js";

const square = [
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100],
];

test("chaikinClosed doubles points and keeps them in bounds", () => {
  const out = chaikinClosed(square, 1);
  assert.equal(out.length, 8);
  for (const [x, y] of out) {
    assert.ok(x > -0.01 && x < 100.01, `x=${x}`);
    assert.ok(y > -0.01 && y < 100.01, `y=${y}`);
  }
});

test("chaikinClosed 0 iterations is identity", () => {
  assert.deepEqual(chaikinClosed(square, 0), square);
});

test("resampleEven yields equal spacing including the loop seam", () => {
  const circle = Array.from({ length: 24 }, (_, i) => [
    Math.cos((i * Math.PI) / 12) * 10,
    Math.sin((i * Math.PI) / 12) * 10,
  ]);
  const out = resampleEven(circle, 0.5, true);
  const d = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const gaps = out.map((p, i) => d(p, out[(i + 1) % out.length]));
  const mn = Math.min(...gaps);
  const mx = Math.max(...gaps);
  assert.ok(mx - mn < 0.02, `gaps vary ${mn}..${mx}`); // seam must not bunch samples
  assert.ok(Math.abs(gaps[0] - 0.5) < 0.02, `spacing=${gaps[0]}`);
  assert.ok(out.length > 30, `len=${out.length}`);
});

test("buildSpline length matches perimeter of square (densified)", () => {
  const sp = buildSpline(resampleEven(square, 2, true), true, 8);
  assert.ok(Math.abs(sp.length - 400) < 8, `length=${sp.length}`);
  assert.equal(sp.cum.length, sp.pts.length);
  assert.equal(sp.cum[0], 0);
  assert.ok(sp.cum.at(-1) > 390, `cum.last=${sp.cum.at(-1)}`);
});

test("nearestIndex with hint and full scan agree", () => {
  const sp = buildSpline(resampleEven(square, 2, true), true, 8);
  let best = 0,
    bd = Infinity;
  sp.pts.forEach(([x, z], i) => {
    const d = (x - 0) ** 2 + (z - 50) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  const far = nearestIndex(sp, 0, 50, -1);
  assert.equal(far, best);
  const near = nearestIndex(sp, 0, 50, best, 60);
  assert.equal(near, best);
});

test("progressAt: lateral offset and tangent heading on straight", () => {
  const sp = buildSpline(resampleEven(square, 2, true), true, 8);
  const p = progressAt(sp, 50, -3, -1); // 3 units "below" bottom edge
  assert.ok(Math.abs(Math.abs(p.lat) - 3) < 0.5, `lat=${p.lat}`);
  assert.ok(p.heading > -0.01 && p.heading < 0.02, `heading=${p.heading}`);
  assert.ok(p.s > 40 && p.s < 60, `s=${p.s}`);
});

test("LapTracker: forward wrap past checkpoint counts one lap", () => {
  const lt = new LapTracker(400);
  let r = lt.update(100, 10);
  assert.equal(r.lap, 0);
  r = lt.update(395, 10);
  assert.equal(r.lap, 0);
  r = lt.update(5, 10);
  assert.equal(r.lap, 1);
  r = lt.update(200, 10);
  assert.equal(r.lap, 1);
  r = lt.update(395, 10);
  r = lt.update(5, 10);
  assert.equal(r.lap, 2, "second lap after re-arm");
});

test("LapTracker: reverse crossing does not count", () => {
  const lt = new LapTracker(400);
  lt.update(395, 10);
  const r = lt.update(380, -10);
  assert.equal(r.lap, 0);
});

test("LapTracker: reverse over the line then forward again does not double count", () => {
  const lt = new LapTracker(400);
  lt.update(395, 10);
  assert.equal(lt.update(5, 10).lap, 1); // real lap
  lt.update(395, -10); // reversed back across the line (disarms)
  assert.equal(lt.update(5, 10).lap, 1); // only 5m driven — no phantom lap
  lt.update(200, 10); // re-arm mid track
  lt.update(395, 10);
  assert.equal(lt.update(5, 10).lap, 2); // genuine second lap
});

test("LapTracker: U-turn mid track never counts", () => {
  const lt = new LapTracker(400);
  lt.update(200, 10);
  lt.update(150, -10);
  lt.update(200, 10);
  assert.equal(lt.lap, 0);
});

test("worldFromPreset fits field and clamps width", () => {
  const w = worldFromPreset({ points: square, width: 14, smoothing: 2 });
  assert.ok(w.spline.length > 300, `splineLen=${w.spline.length}`);
  for (const [x, z] of w.pointsWorld) {
    assert.ok(Math.abs(x) <= 92, `x=${x}`);
    assert.ok(Math.abs(z) <= 92, `z=${z}`);
  }
  assert.ok(w.widthWorld >= 8 && w.widthWorld <= 24);
  assert.ok(Number.isFinite(w.start.heading));
});
