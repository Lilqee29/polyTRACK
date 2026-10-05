import { progressAt, normalAt } from "./track.js";

export const CAR_PARAMS = {
  maxSpeed: 38,
  accel: 22,
  brakeForce: 34,
  drag: 0.6,
  turnRate: 2.4,
  steerLerp: 8,
  offroadFactor: 0.45,
  hardBound: 6,
  reverseMax: 12,
};

export function createCarState(x, z, heading) {
  return { x, z, heading, v: 0, steer: 0, offTrack: false, hint: -1 };
}

// Arcade physics: scalar speed along heading, steering scaled by speed,
// off-track speed cap + drag, soft hard-bound that pulls the car back.
export function stepCar(s, input, dt, track, params = CAR_PARAMS) {
  const P = params;
  let prog = progressAt(track.spline, s.x, s.z, s.hint);
  s.hint = prog.i;
  const half = track.widthWorld / 2;
  const limit = half + P.hardBound;
  const onRoad = Math.abs(prog.lat) <= half;
  s.offTrack = !onRoad;

  if (Math.abs(prog.lat) > limit) {
    const p = track.spline.pts[prog.i];
    const [nx, nz] = normalAt(track.spline, prog.i);
    const sign = prog.lat > 0 ? 1 : -1;
    s.x = p[0] + nx * limit * sign;
    s.z = p[1] + nz * limit * sign;
    s.v *= 0.3;
    prog = progressAt(track.spline, s.x, s.z, prog.i);
    s.hint = prog.i;
  }

  const cap = onRoad ? P.maxSpeed : P.maxSpeed * P.offroadFactor;
  const thr = input.throttle || 0;
  const brk = input.brake || 0;
  s.v += thr * P.accel * dt;
  if (brk > 0) s.v -= brk * P.brakeForce * Math.sign(s.v) * dt;
  s.v -= P.drag * s.v * dt * (onRoad ? 1 : 2.5);
  s.v = Math.max(-P.reverseMax, Math.min(s.v, cap));

  const target = input.steerIn || 0;
  s.steer += (target - s.steer) * Math.min(1, P.steerLerp * dt);
  const grip = Math.min(Math.abs(s.v) / 10, 1);
  s.heading += s.steer * P.turnRate * dt * grip * Math.sign(s.v);

  s.x += Math.cos(s.heading) * s.v * dt;
  s.z += Math.sin(s.heading) * s.v * dt;
  return s;
}

export function keyInput(keys) {
  const up = keys.has("ArrowUp") || keys.has("w") || keys.has("W");
  const down = keys.has("ArrowDown") || keys.has("s") || keys.has("S");
  const left = keys.has("ArrowLeft") || keys.has("a") || keys.has("A");
  const right = keys.has("ArrowRight") || keys.has("d") || keys.has("D");
  return {
    throttle: up ? 1 : 0,
    brake: down ? 1 : 0,
    steerIn: (right ? 1 : 0) + (left ? -1 : 0),
  };
}

// Smooth chase camera: sits 10m behind the car, looks 4m ahead of it.
export function chaseCamera(camera, car, dt) {
  const fx = Math.cos(car.heading);
  const fz = Math.sin(car.heading);
  const k = 1 - Math.exp(-6 * Math.max(dt, 1e-4));
  camera.position.x += (car.x - fx * 10 - camera.position.x) * k;
  camera.position.y += (4.8 - camera.position.y) * k;
  camera.position.z += (car.z - fz * 10 - camera.position.z) * k;
  camera.lookAt(car.x + fx * 4, 1.2, car.z + fz * 4);
}
