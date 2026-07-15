# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

"Monster Feeder" (package `monster-feeder`; repo dir `Rhythmit`) — a web rhythm game: food flies at a monster from four directions; the player presses the matching arrow key as the food fills the target ring at the monster's mouth. TypeScript strict + PixiJS 8 + Web Audio API + Vite 6. No UI framework — plain classes and a hand-rolled screen system routed by a keydown switch in `src/main.ts`.

## Commands

```sh
npm install
npm run dev        # Vite dev server with HMR
npm run build      # tsc --noEmit && vite build  ← the only automated gate
npm run preview    # serve the production build (use this to test worker bundling)
```

There is **no test framework and no linter**. `npm run build` is the type gate; real verification is driving the game headless in a browser — see "Verification" below and the `verify` skill (`.claude/skills/verify/`).

## Hard rules

- **All gameplay timing derives from `AudioContext.currentTime`** — never rAF timestamps or `Date.now()`. rAF drives rendering only (one single rAF loop, started in `main.ts`; `app.ticker` is stopped).
- **Layering** (never invert): `src/core/` = game-agnostic engine (must never know what a "monster" is) → `src/game/` = Monster Feeder specifics → `src/mods/` = content layer (mods + auto-charts, files/IndexedDB/panel UI). User content is plain JSON/assets, no build step (`MODDING.md` is the format reference).
- **Validation errors name the exact file and field** ("chompo.json: animation 'chomp_left' missing"). Broken content must explain itself at import time and never crash mid-song. Use the helpers in `src/core/validate.ts`.
- Vite `base: './'` (GitHub Pages subpaths + itch.io zips). Worker bundling under a relative base is fragile — the autochart worker uses the `new Worker(new URL(...), { type: 'module' })` pattern which works; zip.js has workers disabled for this reason (`src/mods/zip.ts`). Verify any new worker in `npm run build && npm run preview`, not just dev.

## Architecture: the clocks (most bug-prone area)

- `src/core/audio.ts` `AudioClock` owns the lazily-created AudioContext (unlocked on first gesture). `eventTimeToAudioMs(e)` maps a DOM event's `timeStamp` to audio time — input is judged at *event* time, not handler-run time.
- `src/core/conductor.ts` `Conductor` is the authority on song time: `songTimeMs()` = context time minus recorded start (0.2 s lead-in ⇒ negative during lead-in). `startSong(buffer, bpm, offsetMs)` plays an AudioBufferSourceNode; metronome clicks use the lookahead scheduler pattern.
- **Three clocks in `GameplayScreen.update()`** (`src/game/screens/gameplay.ts`) — keep their roles straight:
  - `songMs` — judgment truth, straight off the context clock.
  - `displayMs` = `conductor.displayTimeMs()` = songMs − `outputLatencyMs()` — what the player is *hearing*. Note positions, beat effects, and the receptor pulse render to this. Input judgment, miss sweeping, metronome, and calibration subtract the same latency.
  - `visMs` = hitstop-clamped displayMs — juice clock (monster/particles/splats/float texts). A Perfect freezes it 40 ms. **Note motion is deliberately exempt** — frozen-then-snapping food corrupted timing readability.
  - Particles/splats/floats must be born on the same clock that updates them (`visMs`).
- Calibration (`C` key) stores `mf.calibrationOffsetMs` in localStorage; since output-latency compensation exists it measures only input + human bias.

## Architecture: content pipeline

- `src/core/chart.ts` is the contract: `Chart { version:1, song{title,artist,audio,bpm,offsetMs}, difficulty, notes[] }`, notes in **absolute ms** (not beats), 4 directions, sorted by `parseChart()` — every chart from any source (built-in, mod, auto-generated) must pass `parseChart`.
- `src/mods/registry.ts` `ContentRegistry` is the single catalog (three buckets: built-ins, mods, autocharts). `SongEntry.loadAudio(ctx)` is a lazy `cached()` closure returning an AudioBuffer; gameplay never knows where content came from. After content changes call `songSelect.refresh()` (wired via `onContentChanged`).
- Mods: window-wide drag-drop → `src/mods/drop.ts` → `validateMod` → registry + IndexedDB. Auto-charts (dropped audio files): `src/mods/autochart.ts` decodes on the main thread (**`decodeAudioData` does not exist in workers**), downmixes to mono, transfers PCM to `src/core/autochart/worker.ts` (spectral-flux onset detection → 3 difficulties), caches in IndexedDB keyed by SHA-256 of the file bytes.
- IndexedDB: one DB `mf-mods` (v2) with stores `mods` and `autocharts`, tiny promise wrapper in `src/mods/db.ts`. Boot re-registers both (skip broken records with an error row, keep booting) in `main.ts` `startGame()`.
- Built-in song audio is synthesized offline (`src/game/testtrack.ts`, deterministic seeded noise, 128 BPM) — no audio assets shipped.

## Known gotchas

- `decodeAudioData` **detaches** the ArrayBuffer you pass — always hand it a fresh copy (`blob.arrayBuffer()` per decode).
- `DataTransferItemList` is **neutered as soon as the drop handler yields** — snapshot items/entries synchronously before the first `await` (`src/mods/drop.ts`, `panel.ts`).
- `OfflineAudioContext` rendering is **not bit-deterministic** in Chromium — don't build content-hash tests on re-rendered audio (the self-test memoizes its encoded WAV for this reason).
- tsconfig has `noUncheckedIndexedAccess`: typed-array reads need `!`; `arr[i] += x` won't compile — write `arr[i] = arr[i]! + x`.
- tsconfig lib is DOM (no WebWorker lib): in worker files, bare `postMessage(msg)` type-checks; avoid adding the WebWorker lib globally.

## Verification (no tests — drive the game)

- Headless Chromium works fully (Web Audio advances): launch Playwright with `executablePath: '/opt/pw-browsers/chromium'` and `--autoplay-policy=no-user-gesture-required`. Flow: `goto` → wait ~1.5 s for bootstrap → press any key (unlocks audio, starts the game) → navigate with arrows/Enter.
- The `#debug` overlay (toggle `D`, on by default) is the observation seam: song time, beat, output latency, `next <dir> in <N>ms`, hit error, judged count, FPS. Song-select shows `songselect i/N`.
- **Autoplayer**: poll `#debug` every ~2 ms for `next <dir> in <N>ms`, dispatch the matching `Arrow*` keydown when `N ≤ 40` (dispatch *early*: after the first note of a chord is hit, the partner is only visible while its time is still in the future; throttle same-key re-dispatch by ~60 ms). Synthetic KeyboardEvents are judged correctly (timing uses `e.timeStamp`).
- `window.__autochartSelfTest()` (defined in `main.ts` after game start) runs the synthesized test track through the entire auto-chart import pipeline and returns `{bpm, noteCounts, meanAbsErrMs, signedMeanMs, within25msFrac}`. Pass ≈ bpm ∈ [127,129], signedMeanMs ≈ 0. Use it to recalibrate `ONSET_TIME_CORRECTION_MS` (`src/core/autochart/onsets.ts`) after DSP changes.
- To test output-latency compensation headless, stub it before page load: `page.addInitScript` defining an `AudioContext.prototype.outputLatency` getter; assert the debug `out lat` line and that autoplay still full-combos.

## Deploy

Pushes to `main` deploy to GitHub Pages via `.github/workflows/deploy.yml`. The relative-base `dist/` also works zipped for itch.io.
