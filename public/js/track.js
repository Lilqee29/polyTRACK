// Pure track geometry — no DOM, importable in Node for tests.

function dist(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

export function chaikinClosed(points, iterations) {
  let pts = points.map((p) => [p[0], p[1]]);
  for (let k = 0; k < iterations; k++) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const P = pts[i];
      const Q = pts[(i + 1) % pts.length];
      out.push([P[0] * 0.75 + Q[0] * 0.25, P[1] * 0.75 + Q[1] * 0.25]);
      out.push([P[0] * 0.25 + Q[0] * 0.75, P[1] * 0.25 + Q[1] * 0.75]);
    }
    pts = out;
  }
  return pts;
}

export function resampleEven(points, spacing, closed) {
  const seq = closed ? [...points, points[0]] : [...points];
  const segs = [];
  let total = 0;
  for (let i = 0; i < seq.length - 1; i++) {
    const d = dist(seq[i], seq[i + 1]);
    if (d > 0) {
      segs.push({ a: seq[i], b: seq[i + 1], d });
      total += d;
    }
  }
  const out = [[seq[0][0], seq[0][1]]];
  let next = spacing;
  let acc = 0;
  for (const s of segs) {
    while (next <= acc + s.d && next < total) {
      const t = (next - acc) / s.d;
      out.push([
        s.a[0] + (s.b[0] - s.a[0]) * t,
        s.a[1] + (s.b[1] - s.a[1]) * t,
      ]);
      next += spacing;
    }
    acc += s.d;
  }
  return out;
}

function cr(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  const out = [0, 0];
  for (let c = 0; c < 2; c++) {
    out[c] =
      0.5 *
      (2 * p1[c] +
        (-p0[c] + p2[c]) * t +
        (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 +
        (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3);
  }
  return out;
}

// Closed Catmull-Rom through points → uniform samples + cumulative arc length.
export function buildSpline(points, closed = true, samplesPerSeg = 12) {
  const n = points.length;
  const at = (i) => points[((i % n) + n) % n];
  const pts = [];
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    for (let k = 0; k < samplesPerSeg; k++) {
      pts.push(cr(p0, p1, p2, p3, k / samplesPerSeg));
    }
  }
  const cum = new Array(pts.length);
  cum[0] = 0;
  for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + dist(pts[i - 1], pts[i]);
  const length = cum[pts.length - 1] + dist(pts[pts.length - 1], pts[0]);
  return { pts, cum, length };
}

export function nearestIndex(spline, x, z, hint = -1, window = 60) {
  const pts = spline.pts;
  const n = pts.length;
  const d2 = (i) => {
    const p = pts[i];
    return (p[0] - x) ** 2 + (p[1] - z) ** 2;
  };
  if (hint < 0 || hint >= n) {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < n; i++) {
      const d = d2(i);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }
  let best = hint % n;
  let bd = Infinity;
  for (let o = -window; o <= window; o++) {
    const i = (((hint + o) % n) + n) % n;
    const d = d2(i);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

// Unit left normal of the centerline at sample i (left of travel = positive lat).
export function normalAt(spline, i) {
  const n = spline.pts.length;
  const prev = spline.pts[(i - 1 + n) % n];
  const next = spline.pts[(i + 1) % n];
  let dx = next[0] - prev[0];
  let dz = next[1] - prev[1];
  const len = Math.hypot(dx, dz) || 1;
  return [dz / len, -dx / len];
}

// Signed lateral offset (left of travel = positive), tangent heading, arc position.
export function progressAt(spline, x, z, hint = -1) {
  const i = nearestIndex(spline, x, z, hint);
  const n = spline.pts.length;
  const p = spline.pts[i];
  const prev = spline.pts[(i - 1 + n) % n];
  const next = spline.pts[(i + 1) % n];
  let dx = next[0] - prev[0];
  let dz = next[1] - prev[1];
  const len = Math.hypot(dx, dz) || 1;
  dx /= len;
  dz /= len;
  const heading = Math.atan2(dz, dx);
  const lat = (x - p[0]) * dz - (z - p[1]) * dx;
  return { i, s: spline.cum[i], lat, heading };
}

export class LapTracker {
  constructor(length) {
    this.L = length;
    this.lap = 0;
    this.last = null;
    this.armed = true;
  }

  update(s, dir) {
    let wrapped = false;
    if (
      this.armed &&
      dir > 0 &&
      this.last != null &&
      this.last > 0.75 * this.L &&
      s < 0.25 * this.L
    ) {
      this.lap++;
      wrapped = true;
      this.armed = false;
    }
    if (!this.armed && s > 0.3 * this.L && s < 0.7 * this.L) this.armed = true;
    if (
      dir < 0 &&
      this.last != null &&
      this.last < 0.25 * this.L &&
      s > 0.75 * this.L
    ) {
      this.armed = false;
    }
    this.last = s;
    return { lap: this.lap, wrapped, armed: this.armed };
  }
}

export function worldFromPreset(preset, fieldSize = 180) {
  let pts = chaikinClosed(preset.points, preset.smoothing | 0);
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const dim = Math.max(maxX - minX, maxY - minY) || 1;
  const scale = fieldSize / dim;
  const world = pts.map(([x, y]) => [(x - cx) * scale, (y - cy) * scale]);
  const dense = resampleEven(world, 2, true);
  const spline = buildSpline(dense, true, 6);
  const widthWorld = Math.min(24, Math.max(8, preset.width ?? 14));
  const s0 = spline.pts[0];
  const s1 = spline.pts[1];
  const heading = Math.atan2(s1[1] - s0[1], s1[0] - s0[0]);
  return {
    spline,
    pointsWorld: world,
    widthWorld,
    start: { x: s0[0], z: s0[1], heading },
  };
}
