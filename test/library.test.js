import { test } from "node:test";
import assert from "node:assert/strict";
import { LIBRARY } from "../public/js/library.js";
import { validatePreset } from "../public/js/presets.js";
import { worldFromPreset } from "../public/js/track.js";

test("library: 30 frozen presets, unique ids and names", () => {
  assert.equal(LIBRARY.length, 30);
  assert.ok(Object.isFrozen(LIBRARY));
  const ids = new Set(LIBRARY.map((p) => p.id));
  const names = new Set(LIBRARY.map((p) => p.name));
  assert.equal(ids.size, 30);
  assert.equal(names.size, 30);
  for (const p of LIBRARY) assert.ok(Object.isFrozen(p), `${p.id} must be frozen`);
});

test("library: exactly 10 per theme, ids match theme", () => {
  const counts = { summer: 0, winter: 0, desert: 0 };
  for (const p of LIBRARY) {
    counts[p.theme]++;
    assert.ok(p.id.startsWith(`official-${p.theme}-`), `${p.id} vs ${p.theme}`);
  }
  assert.deepEqual(counts, { summer: 10, winter: 10, desert: 10 });
});

test("library: per-theme difficulty mix 2/3/3/1/1", () => {
  for (const theme of ["summer", "winter", "desert"]) {
    const got = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const p of LIBRARY.filter((q) => q.theme === theme)) got[p.difficulty]++;
    assert.deepEqual(got, { 1: 2, 2: 3, 3: 3, 4: 1, 5: 1 }, theme);
  }
});

test("library: every preset validates and builds a drivable world", () => {
  for (const p of LIBRARY) {
    assert.equal(validatePreset(p), true, `${p.id}: ${validatePreset(p)}`);
    const w = worldFromPreset(p);
    assert.ok(w.spline.length > 400, `${p.id} too short: ${w.spline.length}`);
    assert.ok(w.widthWorld >= 10 && w.widthWorld <= 20, `${p.id} width`);
    assert.equal(p.smoothing, 3);
    let peak = 0;
    for (const h of w.H) peak = Math.max(peak, Math.abs(h));
    assert.ok(peak <= p.elev.amp + 1e-9, `${p.id} amp violated: ${peak}`);
    for (const g of w.G) assert.ok(g >= -0.6 && g <= 0.6, `${p.id} grade clamp`);
  }
});

test("library: each theme mixes flat, rolling and alpine hills", () => {
  for (const theme of ["summer", "winter", "desert"]) {
    const amps = LIBRARY.filter((q) => q.theme === theme).map((q) => q.elev.amp);
    assert.ok(amps.some((a) => a <= 4), `${theme} flat`);
    assert.ok(amps.some((a) => a >= 8 && a <= 16), `${theme} rolling`);
    assert.ok(amps.some((a) => a >= 20 && a <= 34), `${theme} alpine`);
  }
});

test("library: figure-eight tracks carry real elevation at the crossing", () => {
  const eights = LIBRARY.filter((p) => p.shape === "eight");
  assert.equal(eights.length, 6);
  for (const p of eights) assert.ok(p.elev.amp >= 15, `${p.id} needs amp>=15`);
});
