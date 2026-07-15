# Engine

A reusable rhythm-game engine: Web Audio timing, chart format, hit
judgment, scoring, character/atlas content parsing, and audio→chart
auto-generation. This directory is written to be extracted into a
standalone npm package — it contains **no Monster Feeder specifics**,
and the rest of the app consumes it only through the three barrels
below (enforced by `scripts/check-engine-boundary.mjs`, which runs in
`npm run build`).

## Tiers & entry points

| Barrel | Future package export | Contents |
|---|---|---|
| `index.ts` | `"."` | Pure tier: `AudioClock`, `Conductor`, chart parsing, `HitJudge` + timing windows, `ScoreState`/grades, `Hitstop`, render loop, validation helpers, character/atlas parsing. Renderer-agnostic — no pixi.js anywhere beneath it. |
| `pixi/index.ts` | `"./pixi"` | Optional Pixi tier: `ParticleSystem`, `sliceSheet`/`LoadedCharacter`. The only engine code allowed to import `pixi.js`. |
| `autochart/index.ts` | `"./autochart"` | Auto-chart pipeline: `createAutochartWorker()`, message protocol types, difficulty list. DSP internals (fft/onsets/bpm) stay private. |

`autochart/worker.ts` is a side-effectful worker entry (it registers
`self.onmessage` at module load). It is **never** re-exported from a
barrel; only `autochart/spawn.ts` references it.

## Environment requirements

- **Pure tier**: Web Audio (`AudioContext`) and `window.setInterval`
  (the Conductor's lookahead scheduler). No DOM rendering, no storage —
  calibration is passed in as a value (`Conductor.inputTimeMs(audioMs,
  calibrationOffsetMs)`), persistence is the game's job.
- **Pixi tier**: `pixi.js ^8` (peer dependency after extraction) and a
  DOM canvas (`ParticleSystem` bakes its circle texture via
  `document.createElement('canvas')`).
- **Autochart tier**: `Worker` support and a bundler that statically
  rewrites `new Worker(new URL('./worker.ts', import.meta.url),
  { type: 'module' })` (Vite does, including under a relative `base`).
  Audio must be decoded to mono PCM on the main thread —
  `decodeAudioData` does not exist in workers.

## Timing model (the part worth reusing)

All gameplay timing derives from `AudioContext.currentTime` — never
rAF timestamps or `Date.now()`:

- `AudioClock.eventTimeToAudioMs(e)` maps a DOM event's `timeStamp`
  onto the audio clock, so input is judged at *event* time.
- `Conductor.songTimeMs()` is judgment truth; `displayTimeMs()`
  subtracts output latency (what the player is *hearing*) — render to
  it; `inputTimeMs(audioMs, calibration)` is the calibrated song time
  to judge input against.
- `HitJudge` consumes notes against `WINDOWS`; `Hitstop` clamps a
  separate juice clock for freeze-frames without corrupting note motion.

## Extraction checklist

1. Copy this directory into a package; add an `exports` map for the
   three entries (`.`, `./pixi`, `./autochart`).
2. `pixi.js` becomes an optional peerDependency (only `./pixi` needs it).
3. Set `sideEffects: ["**/worker.ts"]` so bundlers never tree-shake or
   hoist the worker entry.
4. Keep TypeScript strictness — `noUncheckedIndexedAccess` idioms
   (`arr[i]!`) are load-bearing in the DSP code.
5. Port `scripts/check-engine-boundary.mjs` as the package's layering
   guard.

## Rules for code in this directory

- No game vocabulary (no "monster", "food", "chomp" — a required
  animation list is the game's business, see `missingAnimations`).
- No `localStorage` or other persistence.
- No `pixi.js` imports outside `pixi/`.
- Imports never reach outside `src/engine/`.
- Validation errors name the exact file and field (`validate.ts`
  helpers) — broken content must explain itself at import time.
