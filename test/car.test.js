import { test } from "node:test";
import assert from "node:assert/strict";
import { createCarState, stepCar, chaseCamera, keyInput } from "../public/js/car.js";
import { buildSpline, resampleEven, progressAt } from "../public/js/track.js";

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
  const car = { x: 100, z: 0, heading: 0 }; // facing +X → camera behind = x-10
  for (let i = 0; i < 400; i++) chaseCamera(cam, car, 1 / 60);
  assert.ok(Math.abs(cam.position.x - 90) < 1, `x=${cam.position.x}`);
  assert.ok(Math.abs(cam.position.z - 0) < 1, `z=${cam.position.z}`);
  assert.ok(cam.position.y > 3 && cam.position.y < 6, `y=${cam.position.y}`);
  assert.ok(cam.calls > 0);
});
