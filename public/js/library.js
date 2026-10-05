// Official track library — 30 deterministic parametric layouts (10 per theme).
// Pure data: no DOM, importable in Node for tests.

const TAU = Math.PI * 2;

function ellipse(cx, cy, rx, ry, n) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU;
    pts.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry]);
  }
  return pts;
}

// Closed radial modulation: lobes in/out (kidney, flower, teardrop, chicane).
function blob(cx, cy, r, n, lobes, wobble) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU;
    const rr = r * (1 + wobble * Math.cos(lobes * t));
    pts.push([cx + Math.cos(t) * rr, cy + Math.sin(t) * rr]);
  }
  return pts;
}

// Bernoulli lemniscate — crossed loop; always paired with real elevation
// so the crossing strands separate vertically.
function figure8(cx, cy, a, n) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU;
    const d = 1 + Math.sin(t) ** 2;
    pts.push([cx + (a * Math.cos(t)) / d, cy + (a * Math.sin(t) * Math.cos(t)) / d]);
  }
  return pts;
}

let seedCounter = 1000;
function mk(theme, nn, name, points, difficulty, amp, width, shape = "loop") {
  const preset = {
    id: `official-${theme}-${String(nn).padStart(2, "0")}`,
    name,
    points,
    width,
    smoothing: 3,
    theme,
    elev: { amp, seed: (seedCounter += 1) },
    difficulty,
    shape,
    createdAt: 0,
  };
  return Object.freeze(preset);
}

export const LIBRARY = Object.freeze([
  // ---- summer ----
  mk("summer", 1, "Sunrise Oval", ellipse(400, 400, 280, 160, 24), 1, 0, 16),
  mk("summer", 2, "Meadow Loop", blob(400, 400, 240, 22, 2, 0.18), 1, 0, 14),
  mk("summer", 3, "Palm Circuit", ellipse(400, 400, 240, 240, 26), 2, 10, 14),
  mk("summer", 4, "Coastal Chicane", blob(400, 400, 250, 26, 3, 0.28), 2, 12, 16),
  mk("summer", 5, "Firefly Eight", figure8(400, 400, 300, 40), 3, 16, 12, "eight"),
  mk("summer", 6, "Grasshopper", blob(400, 400, 250, 30, 4, 0.22), 2, 14, 14),
  mk("summer", 7, "Harvest Ring", ellipse(400, 400, 300, 200, 28), 3, 24, 14),
  mk("summer", 8, "Beachcomber", blob(400, 400, 260, 24, 1, -0.3), 3, 10, 16),
  mk("summer", 9, "Lakeside Sweep", figure8(400, 400, 320, 44), 4, 26, 12, "eight"),
  mk("summer", 10, "County Line", blob(400, 400, 250, 32, 3, 0.3), 5, 32, 12),

  // ---- winter ----
  mk("winter", 1, "Frostbite", ellipse(400, 400, 280, 150, 24), 1, 0, 16),
  mk("winter", 2, "Aurora Ring", blob(400, 400, 240, 22, 2, 0.15), 1, 0, 14),
  mk("winter", 3, "Glacier Run", ellipse(400, 400, 260, 220, 26), 2, 12, 14),
  mk("winter", 4, "Snowdrift Eight", figure8(400, 400, 290, 40), 2, 16, 14, "eight"),
  mk("winter", 5, "Polar Bend", blob(400, 400, 260, 24, 1, -0.28), 2, 10, 16),
  mk("winter", 6, "Icebreaker", blob(400, 400, 250, 30, 4, 0.25), 3, 14, 14),
  mk("winter", 7, "Whiteout Chicane", blob(400, 400, 250, 28, 3, 0.3), 3, 16, 14),
  mk("winter", 8, "Tundra Loop", ellipse(400, 400, 310, 190, 28), 3, 28, 14),
  mk("winter", 9, "Powder Keg", figure8(400, 400, 330, 44), 4, 30, 12, "eight"),
  mk("winter", 10, "Avalanche", blob(400, 400, 250, 32, 3, 0.33), 5, 34, 12),

  // ---- desert ----
  mk("desert", 1, "Mirage", ellipse(400, 400, 280, 160, 24), 1, 0, 16),
  mk("desert", 2, "Saguaro Spin", ellipse(400, 400, 240, 240, 26), 1, 0, 14),
  mk("desert", 3, "Dune Cruiser", blob(400, 400, 250, 24, 2, 0.16), 2, 8, 14),
  mk("desert", 4, "Cactus Eight", figure8(400, 400, 290, 40), 2, 16, 14, "eight"),
  mk("desert", 5, "Oasis Loop", blob(400, 400, 260, 24, 1, -0.25), 2, 10, 16),
  mk("desert", 6, "Sandstorm", blob(400, 400, 250, 28, 3, 0.26), 3, 14, 14),
  mk("desert", 7, "Mesa Run", ellipse(400, 400, 300, 210, 28), 3, 22, 14),
  mk("desert", 8, "Scorpion Tail", blob(400, 400, 250, 30, 4, 0.3), 3, 26, 14),
  mk("desert", 9, "Canyon Chicane", figure8(400, 400, 320, 44), 4, 28, 12, "eight"),
  mk("desert", 10, "Dust Devil", blob(400, 400, 250, 32, 3, 0.33), 5, 34, 12),
]);
