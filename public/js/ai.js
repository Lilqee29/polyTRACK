import { progressAt } from "./track.js";

function wrapAngle(a) {
  return ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
}

function tangentHeading(spline, i) {
  const n = spline.pts.length;
  const prev = spline.pts[(i - 1 + n) % n];
  const next = spline.pts[(i + 1) % n];
  return Math.atan2(next[1] - prev[1], next[0] - prev[0]);
}

export function createAI(state, skill = 0.9) {
  return { state, skill, hint: -1, lap: 0 };
}

const LAT_ACCEL = 18;

export function aiInput(ai, track, dt, playerState) {
  const s = ai.state;
  const spline = track.spline;
  const prog = progressAt(spline, s.x, s.z, ai.hint);
  ai.hint = prog.i;
  const n = spline.pts.length;
  const spacing = spline.length / n;

  const L = Math.min(16, Math.max(8, 6 + Math.abs(s.v) * 0.5));
  const ahead = Math.max(2, Math.round(L / spacing));
  const tIdx = (prog.i + ahead) % n;
  const target = spline.pts[tIdx];
  const ang = Math.atan2(target[1] - s.z, target[0] - s.x);
  const diff = wrapAngle(ang - s.heading);
  const steerIn = Math.max(-1, Math.min(1, diff * 1.8));

  // curvature-limited target speed over the lookahead window
  let targetSpeed = 38 * ai.skill;
  const KW = Math.max(4, Math.round(14 / spacing));
  for (let j = prog.i; j < prog.i + KW; j++) {
    const a = ((j % n) + n) % n;
    const b = ((j + 1) % n + n) % n;
    const seg = Math.hypot(
      spline.pts[b][0] - spline.pts[a][0],
      spline.pts[b][1] - spline.pts[a][1]
    );
    if (seg < 1e-9) continue;
    const dth = Math.abs(wrapAngle(tangentHeading(spline, b) - tangentHeading(spline, a)));
    const kappa = dth / seg;
    if (kappa > 1e-4) targetSpeed = Math.min(targetSpeed, Math.sqrt(LAT_ACCEL / kappa));
  }

  // rubber-band: trailing AI gets a small boost, leading one a small damper
  if (playerState) {
    const pProg = progressAt(spline, playerState.x, playerState.z, -1);
    const aiAbs = (ai.lap || 0) * spline.length + prog.s;
    const plAbs = (playerState.lap || 0) * spline.length + pProg.s;
    const rb = Math.max(0.9, Math.min(1.1, 1 + (plAbs - aiAbs) / 600));
    targetSpeed *= rb;
  }

  const d = targetSpeed - s.v;
  const throttle = d > 0.5 ? 1 : d > 0 ? d / 0.5 : 0;
  const brake = d < -1 ? Math.min(1, -d / 12) : 0;
  return { throttle, brake, steerIn };
}

// Equal-share push-apart for overlapping cars.
export function separateCars(states, radius = 3.2) {
  for (let i = 0; i < states.length; i++) {
    for (let j = i + 1; j < states.length; j++) {
      const A = states[i];
      const B = states[j];
      const dx = B.x - A.x;
      const dz = B.z - A.z;
      const d = Math.hypot(dx, dz);
      if (d >= radius) continue;
      const push = (radius - d) / 2;
      const nx = d < 1e-6 ? 1 : dx / d;
      const nz = d < 1e-6 ? 0 : dz / d;
      A.x -= nx * push;
      A.z -= nz * push;
      B.x += nx * push;
      B.z += nz * push;
    }
  }
}
