import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createPresetStore,
  makePreset,
  normalizePreset,
  validatePreset,
} from "../public/js/presets.js";

const shim = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
};

test("save + list roundtrip", () => {
  const s = createPresetStore(shim());
  const p = makePreset("Loop", [[0, 0], [50, 0], [50, 50], [0, 50]], 14, 2);
  assert.equal(validatePreset(p), true);
  s.save(p);
  assert.equal(s.list().length, 1);
  assert.equal(s.get(p.id).name, "Loop");
});

test("duplicate id overwrites (upsert)", () => {
  const s = createPresetStore(shim());
  const p = makePreset("A", [[0, 0], [10, 0], [10, 10], [0, 10]], 10, 1);
  s.save(p);
  p.name = "B";
  s.save(p);
  assert.equal(s.list().length, 1);
  assert.equal(s.get(p.id).name, "B");
});

test("remove + export/import", () => {
  const s = createPresetStore(shim());
  s.save(makePreset("X", [[0, 0], [10, 0], [10, 10], [0, 10]], 12, 0));
  const json = s.exportAll();
  s.remove(s.list()[0].id);
  assert.equal(s.list().length, 0);
  const n = createPresetStore(shim());
  assert.equal(n.importAll(json), 1);
  assert.equal(n.list()[0].name, "X");
});

test("validation rejects bad input", () => {
  assert.notEqual(validatePreset({ points: [[0, 0], [1, 1]] }), true);
  assert.notEqual(validatePreset({ points: [["a", 0], [1, 1], [2, 2], [3, 3]] }), true);
  assert.notEqual(validatePreset(null), true);
  assert.notEqual(validatePreset({ points: [[0, 0], [1, 1], [2, 2], [3, 3]], width: 9999 }), true);
});

test("importAll rejects malformed JSON with false", () => {
  const s = createPresetStore(shim());
  assert.equal(s.importAll("{nope"), false);
});

test("schema v2: makePreset adds theme + elev defaults", () => {
  const p = makePreset("Hilly", [[0, 0], [50, 0], [50, 50], [0, 50]], 14, 2);
  assert.equal(p.theme, "summer");
  assert.ok(p.elev && typeof p.elev === "object");
  assert.equal(p.elev.amp, 0);
  assert.ok(Number.isFinite(p.elev.seed));
  const q = makePreset("Winter", [[0, 0], [50, 0], [50, 50], [0, 50]], 14, 2, {
    theme: "winter",
    elev: { amp: 22, seed: 7 },
  });
  assert.equal(q.theme, "winter");
  assert.deepEqual(q.elev, { amp: 22, seed: 7 });
});

test("schema v2: validatePreset rejects bad theme and elev", () => {
  const pts = [[0, 0], [1, 1], [2, 2], [3, 3]];
  assert.equal(validatePreset({ points: pts, theme: "spring" }), "theme must be summer|winter|desert");
  assert.notEqual(validatePreset({ points: pts, elev: "high" }), true);
  assert.notEqual(validatePreset({ points: pts, elev: { amp: -1, seed: 0 } }), true);
  assert.notEqual(validatePreset({ points: pts, elev: { amp: 99, seed: 0 } }), true);
  assert.notEqual(validatePreset({ points: pts, elev: { amp: 10, seed: "x" } }), true);
  assert.equal(validatePreset({ points: pts, theme: "desert", elev: { amp: 40, seed: -3 } }), true);
});

test("schema v2: normalizePreset fills defaults, keeps valid values", () => {
  const pts = [[0, 0], [1, 1], [2, 2], [3, 3]];
  const n = normalizePreset({ id: "a", name: "A", points: pts, width: 12, smoothing: 2 });
  assert.equal(n.theme, "summer");
  assert.deepEqual(n.elev, { amp: 0, seed: 0 });
  const m = normalizePreset({ id: "b", name: "B", points: pts, width: 12, smoothing: 2, theme: "desert", elev: { amp: 18, seed: 5 } });
  assert.equal(m.theme, "desert");
  assert.deepEqual(m.elev, { amp: 18, seed: 5 });
  const bad = normalizePreset({ id: "c", name: "C", points: pts, width: 12, smoothing: 2, theme: "fog", elev: { amp: 999, seed: 1 } });
  assert.equal(bad.theme, "summer");
  assert.deepEqual(bad.elev, { amp: 0, seed: 0 });
});

test("schema v2: export/import keeps theme + elev", () => {
  const s = createPresetStore(shim());
  const p = makePreset("T", [[0, 0], [50, 0], [50, 50], [0, 50]], 14, 3, {
    theme: "winter",
    elev: { amp: 25, seed: 42 },
  });
  s.save(p);
  const json = s.exportAll();
  const n = createPresetStore(shim());
  assert.equal(n.importAll(json), 1);
  const got = n.get(p.id);
  assert.equal(got.theme, "winter");
  assert.deepEqual(got.elev, { amp: 25, seed: 42 });
});
