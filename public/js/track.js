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
      segs.push({ a: seq[i], b: seq[i + 1], d, cum: total });
      total += d;
    }
  }
  if (!segs.length) return [[seq[0][0], seq[0][1]]];
  if (!closed) {
    const out = [[seq[0][0], seq[0][1]]];
    let next = spacing;
    let acc = 0;
    for (const s of segs) {
      while (next <= acc + s.d && next < total) {
        const t = (next - acc) / s.d;
        out.push([s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t]);
        next += spacing;
      }
      acc += s.d;
    }
    return out;
  }
  // Closed: exact uniform spacing including the final gap back to the start,
  // so downstream tangent estimates never see a degenerate bunch of samples.
  const K = Math.max(2, Math.round(total / spacing));
  const out = [];
  let si = 0;
  for (let i = 0; i < K; i++) {
    const t = (i * total) / K;
    while (si < segs.length - 1 && segs[si].cum + segs[si].d < t) si++;
    const s = segs[si];
    const f = Math.min(1, Math.max(0, (t - s.cum) / s.d));
    out.push([s.a[0] + (s.b[0] - s.a[0]) * f, s.a[1] + (s.b[1] - s.a[1]) * f]);
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

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Closed-loop height profile h(u), u in [0,1]. Integer frequencies make
// h(0) == h(1) so the loop seam is continuous. |h| <= amp.
export function elevationProfile(elev) {
  const amp = Number(elev?.amp) || 0;
  const rng = mulberry32((Number(elev?.seed) | 0) >>> 0);
  const k1 = 1 + Math.floor(rng() * 2); // 1..2
  const k2 = 2 + Math.floor(rng() * 2); // 2..3
  const k3 = 3 + Math.floor(rng() * 2); // 3..4
  const p1 = rng() * Math.PI * 2;
  const p2 = rng() * Math.PI * 2;
  const p3 = rng() * Math.PI * 2;
  return (u) =>
    amp *
    (0.65 * Math.sin(2 * Math.PI * k1 * u + p1) +
      0.25 * Math.sin(2 * Math.PI * k2 * u + p2) +
      0.1 * Math.sin(2 * Math.PI * k3 * u + p3));
}

// Height at sample i, lerped by frac toward the next sample.
export function heightAt(world, i, frac = 0) {
  const H = world.H;
  if (!H || !H.length) return 0;
  const n = H.length;
  const a = H[((i % n) + n) % n];
  const b = H[(((i + 1) % n) + n) % n];
  return a + (b - a) * Math.min(1, Math.max(0, frac));
}

// Fraction along segment i at the projection of (x,z); 0..1.
export function fracAt(spline, i, x, z) {
  const n = spline.pts.length;
  const a = spline.pts[((i % n) + n) % n];
  const b = spline.pts[(((i + 1) % n) + n) % n];
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz || 1;
  return Math.min(1, Math.max(0, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
}

// Slope of the segment containing sample i (or the segment metersAhead
// further along the loop). Clamped to ±0.6 by worldFromPreset.
export function gradeAt(world, i, metersAhead = 0) {
  const G = world.G;
  const spline = world.spline;
  if (!G || !G.length || !spline) return 0;
  const n = G.length;
  let s = spline.cum[((i % n) + n) % n] + Math.max(0, metersAhead);
  if (spline.length > 0) s %= spline.length;
  let idx = 0;
  const cum = spline.cum;
  while (idx < n - 1 && cum[idx + 1] <= s) idx++;
  return G[idx];
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
  const dense = resampleEven(world, 1.25, true);
  const spline = buildSpline(dense, true, 6);
  const widthWorld = Math.min(24, Math.max(8, preset.width ?? 14));
  const s0 = spline.pts[0];
  const s1 = spline.pts[1];
  const heading = Math.atan2(s1[1] - s0[1], s1[0] - s0[0]);

  const e = preset.elev;
  const elev =
    e && Number.isFinite(e.amp) && e.amp >= 0 && e.amp <= 40 && Number.isFinite(e.seed)
      ? { amp: e.amp, seed: e.seed }
      : { amp: 0, seed: 0 };
  const n = spline.pts.length;
  const H = new Float64Array(n);
  const G = new Float64Array(n);
  if (elev.amp > 0) {
    const h = elevationProfile(elev);
    const L = spline.length || 1;
    for (let i = 0; i < n; i++) H[i] = h(spline.cum[i] / L);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ds = Math.hypot(spline.pts[j][0] - spline.pts[i][0], spline.pts[j][1] - spline.pts[i][1]) || 0.01;
    const g = (H[j] - H[i]) / ds;
    G[i] = Math.min(0.6, Math.max(-0.6, g));
  }

  return {
    spline,
    pointsWorld: world,
    widthWorld,
    start: { x: s0[0], z: s0[1], heading, y: H[0] },
    H,
    G,
    elev,
  };
}
