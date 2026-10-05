import { test } from "node:test";
import assert from "node:assert/strict";
import { createAI, aiInput, separateCars } from "../public/js/ai.js";
import { createCarState } from "../public/js/car.js";
import { buildSpline, resampleEven } from "../public/js/track.js";

const sq = [
  [0, 0],
  [400, 0],
  [400, 400],
  [0, 400],
];
const track = {
  spline: buildSpline(resampleEven(sq, 2, true), true, 8),
  widthWorld: 14,
};

test("AI steers toward track when off the centerline", () => {
  const ai = createAI(createCarState(200, -4, 0), 0.9);
  ai.state.v = 20;
  const inp = aiInput(ai, track, 1 / 60, null);
  assert.ok(inp.steerIn !== 0, "must correct heading");
  assert.ok(Math.abs(inp.steerIn) <= 1);
  assert.ok(inp.throttle > 0 || inp.brake >= 0);
});

test("AI lifts off before sharp corner", () => {
  const far = createAI(createCarState(360, 0, 0), 0.95);
  far.state.v = 35;
  const a = aiInput(far, track, 1 / 60, null);
  const near = createAI(createCarState(394, 0, 0), 0.95);
  near.state.v = 35;
  const b = aiInput(near, track, 1 / 60, null);
  assert.ok(
    b.throttle < a.throttle || b.brake > 0,
    `straight=${JSON.stringify(a)} corner=${JSON.stringify(b)}`
  );
});

test("rubberband: trailing AI is more aggressive than leading", () => {
  const ai = createAI(createCarState(100, 0, 0), 0.9);
  ai.state.v = 30;
  const playerBehind = { ...createCarState(300, 0, 0), v: 0 };
  const playerAhead = { ...createCarState(40, 0, 0), v: 0 };
  const a = aiInput(ai, track, 1 / 60, playerBehind);
  const b = aiInput(ai, track, 1 / 60, playerAhead);
  const score = (x) => x.throttle - x.brake;
  assert.ok(score(a) >= score(b) - 1e-9, `a=${JSON.stringify(a)} b=${JSON.stringify(b)}`);
});

test("separateCars pushes overlapping cars apart", () => {
  const A = createCarState(0, 0, 0);
  const B = createCarState(1, 0, 0);
  separateCars([A, B], 3.2);
  assert.ok(Math.hypot(A.x - B.x, A.z - B.z) > 3.0);
});

test("separateCars is a no-op when far apart", () => {
  const A = createCarState(0, 0, 0);
  const B = createCarState(50, 0, 0);
  separateCars([A, B], 3.2);
  assert.equal(A.x, 0);
  assert.equal(B.x, 50);
});
