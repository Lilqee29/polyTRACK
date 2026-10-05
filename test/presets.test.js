import { test } from "node:test";
import assert from "node:assert/strict";
import { createPresetStore, makePreset, validatePreset } from "../public/js/presets.js";

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
