# polyTRACK v2 Design — 30 Tracks, 3 Worlds, Real Hills

Date: 2026-10-05 · Status: approved (user: "go")
Reference: PolyTrack by Kodub (itch.io) — Summer/Winter/Desert official tracks, slopes, jumps, TrackMania-style time trials.

## Goals

1. **Smooth tracks** — eliminate visible faceting in road curves and the editor preview.
2. **Elevation** — roller-coaster hills, crests with airtime, gravity-driven speed changes.
3. **Themes** — Summer (baseline), Winter (slippery), Desert (sandy) affecting scenery and light handling.
4. **30 official tracks** — 10 per theme, varied layouts and difficulties, playable from the menu without drawing.
5. Backward compatibility: existing saved presets, MP, offline mode keep working.

## Out of scope

Vertical loops, wall rides, banked-curve physics, audio, ghosts, mobile controls. (Loops need full 3D gravity; deferred.)

## Data model (preset schema v2)

```js
{
  id, name, points, width, smoothing, createdAt,   // v1 unchanged
  theme: "summer" | "winter" | "desert",           // default "summer"
  elev: { amp: 0..40, seed: int }                  // default { amp: 0, seed: 0 } = flat
}
```

- `validatePreset` gains: theme enum check (`"theme must be summer|winter|desert"`), elev checks
  (`"elev.amp must be 0..40"`, `"elev.seed must be a finite number"`). Missing fields remain valid.
- `makePreset(name, points, width, smoothing, opts)` — `opts = { theme, elev }`; defaults summer /
  `{ amp: 0, seed: random }`.
- `normalizePreset(p)` — used at every consumption site (race, scene, net): fills missing theme/elev;
  invalid values fall back to defaults instead of throwing.
- Export/import (JSON) carries the new fields automatically (whole-object serialization).

## Elevation (track.js)

- Profile along normalized cumulative arc length `u ∈ [0,1]` of the resampled spline:

  `h(u) = amp · (0.65·sin(2πk₁u+φ₁) + 0.25·sin(2πk₂u+φ₂) + 0.10·sin(2πk₃u+φ₃))`

  - `k = [1..2, 2..3, 3..4]` and phases `φ` derived from seeded PRNG (mulberry32-style, seed from preset).
  - Integer frequencies ⇒ `h(0) = h(1)` exactly (closed-loop seam safe).
  - Bound: `|h(u)| ≤ amp`. Grade: `|dh/ds|` clamped to ±0.6 at read time.
- `worldFromPreset` additionally returns:
  - `H: Float64Array` — height at each `spline.pts[i]` (parallel array; **no change to 2D point format**),
  - `L` — total arc length,
  - `heightAt(i, frac)` / `gradeAt(i, frac)` helpers (lerp between neighbors; grade = Δh/Δs clamped).
- All existing 2D logic (progress, laps, minimap, AI steering, lobby, MP wire format) is untouched.
- Car Y: every grounded car reads `heightAt` via its maintained hint index; mesh Y follows; camera
  follows Y; `resetPlayer` restores Y; remote (MP) cars derive Y locally from buffered `s` — no
  protocol change.

## Physics (car.js)

- Longitudinal grade term while grounded: `a -= 9.0 · grade` (uphill slows, downhill accelerates;
  downhill top speed capped at `maxSpeed · 1.15`).
- **Airtime**: when grounded ∧ `v ≥ 16` ∧ `gradeNow ≥ 0.10` ∧ `gradeAhead(5m) ≤ −0.10` (convex crest):
  become airborne with `vy = clamp(v · gradeNow, 0, 8)`. Airborne: 2D stepping continues, `y += vy·dt`,
  `vy -= 18·dt`; landing when `y ≤ roadY` → snap, `vy = 0`, `v ·= 0.96`, camera dip flag. Safety: forced
  land after 1.5 s airborne.
- Applied to all cars uniformly (AI included; AI grade-aware speeds keep launches modest).

## Themes

| | Summer | Winter | Desert |
|---|---|---|---|
| ground / sky / fog | greens / blue | snow-white / pale | sand / warm blue |
| props | trees + rocks | snow-pines + white rocks | cacti + dunes |
| road tint | neutral | blue-gray | warm gray |
| handling mods | ×1.0 | turn ×0.85, brake ×0.75 | turn ×0.95, off-road drag ×1.6, accel ×0.95 |

- Handling mods merge into the params passed to `stepCar` per race (signature unchanged).
- `scene.setTrack(world, seed, theme)` — palette, fog, prop set switch by theme.
- Editor: theme dropdown + "Hills" slider (amp 0–30 m; seed stored in preset, stable while editing points).

## Official track library (`public/js/library.js`)

- Exports `LIBRARY`: 30 frozen preset objects, ids `official-{theme}-{nn}`, generated deterministically
  from parametric layout families (oval/circuit, serpentine, figure-8, hairpin ring, speed blast,
  lollipop, chicane ring, kidney…) — no randomness at module load.
- Distribution: exactly 10 summer / 10 winter / 10 desert; per theme roughly 2×1★, 3×2★, 3×3★,
  1×4★, 1×5★ difficulty; elevation mix: some flat (amp ≤ 4), rolling (8–16), alpine (20–34);
  smoothing default 3; widths 10–20.
- Validated by unit tests: `validatePreset === true`, unique ids/names, theme counts, ≥6 points each.

## UI / wiring

- Presets panel: new **Official tracks** section (theme badge + ★ difficulty + hills meta) above
  Saved presets. Race → direct stash; Edit → copy into store (`id` regenerated, name +" (copy)"), open editor.
- Lobby track select: `<optgroup>` Official + Saved (`net.js fillTracks`).
- `main.js` stash/edit/import paths pass v2 fields through untouched (whole objects).
- Service worker: add `/js/library.js` to `CORE`, bump `CACHE` to `polytrack-v2` (old cache purged on activate).

## Smoothness pass

- `worldFromPreset` resample spacing 2 m → **1.25 m** (denser quads on tight curvature).
- Editor canvas draws the actual smoothed spline (same Chaikin pipeline + density), not raw segments.
- Road/curb/shoulder surface: averaged vertex normals across adjacent segments (props stay flat-shaded).
- Library tracks use smoothing 3.

## Error handling

- Invalid theme/elev at consumption → normalized to summer/flat (never throws mid-race).
- `validatePreset` rejects bad values at save/import time with specific messages (tested).
- Missing `library.js` (offline SW miss) → menu still works; official section hides (defensive import).

## Testing

**Unit (node:test):**
- elevation: seam `h(0)=h(1)`, `|h| ≤ amp`, seeded determinism, grade clamp ±0.6.
- physics: uphill slows / downhill boosts; airtime launch→land transitions; landing damping.
- presets: schema v2 validation messages; old (v1) preset normalizes to summer/flat.
- library: 30 valid, 10/theme, unique ids/names, difficulty + amp ranges present.
- smoothness: per-step turn angle < 15° for every library track after resample; elevation step < bounds.

**Browser smoke (Playwright, temp dir):**
- draw→save→race keeps working (regression); winter official race: snow ground + car Y varies over time
  (min/max spread > 2 m); desert grip observable (brake distance longer than summer on same input);
  2-client MP with a themed elevated preset; offline reload includes library; SW cache is `polytrack-v2`.

## Docs

README: new features, official tracks, theme/hills editor controls, SW note. Final regression:
`npm test` + all browser smokes green before v2 commits complete.
