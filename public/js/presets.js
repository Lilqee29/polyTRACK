// Preset storage — injectable storage backend so tests can run in Node.
const KEY = "polytrack.presets";

export function validatePreset(p) {
  if (!p || typeof p !== "object") return "not an object";
  if (!Array.isArray(p.points) || p.points.length < 4) return "needs at least 4 points";
  for (const pt of p.points) {
    if (
      !Array.isArray(pt) ||
      pt.length < 2 ||
      !Number.isFinite(pt[0]) ||
      !Number.isFinite(pt[1])
    ) {
      return "points must be finite [x,y] pairs";
    }
  }
  if (p.width !== undefined && (!Number.isFinite(p.width) || p.width < 8 || p.width > 24)) {
    return "width must be 8..24";
  }
  if (
    p.smoothing !== undefined &&
    (!Number.isFinite(p.smoothing) || p.smoothing < 0 || p.smoothing > 4)
  ) {
    return "smoothing must be 0..4";
  }
  return true;
}

export function makePreset(name, points, width, smoothing) {
  const id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  return {
    id,
    name: String(name || "Untitled").slice(0, 32),
    points: points.map(([x, y]) => [x, y]),
    width: Math.min(24, Math.max(8, Number(width) || 14)),
    smoothing: Math.min(4, Math.max(0, Math.round(Number(smoothing) || 0))),
    createdAt: Date.now(),
  };
}

export function createPresetStore(storage) {
  function read() {
    try {
      const raw = storage.getItem(KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }
  function write(arr) {
    storage.setItem(KEY, JSON.stringify(arr));
  }
  return {
    list() {
      return read();
    },
    get(id) {
      return read().find((p) => p.id === id) ?? null;
    },
    save(preset) {
      if (validatePreset(preset) !== true) return false;
      const arr = read();
      const i = arr.findIndex((p) => p.id === preset.id);
      if (i >= 0) arr[i] = preset;
      else arr.push(preset);
      write(arr);
      return true;
    },
    remove(id) {
      write(read().filter((p) => p.id !== id));
    },
    exportAll() {
      return JSON.stringify({ app: "polytrack", presets: read() }, null, 2);
    },
    importAll(json) {
      let data;
      try {
        data = JSON.parse(json);
      } catch {
        return false;
      }
      const incoming = Array.isArray(data) ? data : data?.presets;
      if (!Array.isArray(incoming)) return false;
      const arr = read();
      let n = 0;
      for (const p of incoming) {
        if (validatePreset(p) !== true) continue;
        const preset = {
          id: p.id || makePreset(p.name, p.points, p.width, p.smoothing).id,
          name: String(p.name || "Untitled").slice(0, 32),
          points: p.points.map(([x, y]) => [x, y]),
          width: Math.min(24, Math.max(8, p.width ?? 14)),
          smoothing: Math.min(4, Math.max(0, p.smoothing ?? 0)),
          createdAt: p.createdAt || Date.now(),
        };
        const i = arr.findIndex((q) => q.id === preset.id);
        if (i >= 0) arr[i] = preset;
        else arr.push(preset);
        n++;
      }
      write(arr);
      return n;
    },
  };
}
