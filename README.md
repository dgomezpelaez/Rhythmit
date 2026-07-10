# Monster Feeder

A web-based rhythm game with a mascot character at its center. Food flies at a
hungry monster from four directions in sync with the music; the player presses
the matching direction key exactly as food reaches its mouth. Built to run on
the web with zero friction, be moddable without touching engine code, and be
designed for sharing.

## Development

```sh
npm install
npm run dev      # dev server with HMR
npm run build    # typecheck + production build into dist/
npm run preview  # serve the production build locally
```

Stack: TypeScript + PixiJS (rendering) + Web Audio API (all game timing) +
Vite (build).

**Hard rule:** all game timing derives from `AudioContext.currentTime` —
never `requestAnimationFrame` timestamps or `Date.now()`. rAF drives
rendering only.

## Current state (Phase 1 — the Conductor)

Click/press any key to start audio, then:

- **Metronome screen** (default): 120 BPM clicks with a puck that lands on
  the hit line every beat — the drift test. Tap `space`/arrows/click on the
  beat to see your timing error in ms.
- **`C`** — latency calibration: tap along at 90 BPM (4 warm-up + 12 counted
  taps); the average offset is stored in localStorage and applied to all
  future input. `Esc` cancels.
- **`D`** — toggle the debug overlay (audio/song time, beat, tap error,
  calibration offset, FPS).

## Architecture

```
┌─────────────────────────────────────────┐
│  MOD LAYER (user content, no build step) │
│  mod.json · charts · sprites · audio     │
│  optional sandboxed behavior scripts     │
├─────────────────────────────────────────┤
│  GAME LAYER (Monster Feeder specifics)   │
│  monster character · food entities ·     │
│  reactions · scoring · screens/menus     │
├─────────────────────────────────────────┤
│  CORE ENGINE (game-agnostic)             │
│  audio clock · conductor · beatmap       │
│  loader · input · hit judgment ·         │
│  asset pipeline · particle system        │
└─────────────────────────────────────────┘
```

`src/core/` is the game-agnostic engine (it never knows what a "monster" is);
`src/game/` holds Monster Feeder specifics; the mod layer is plain
JSON/assets loaded at runtime.

## Deployment

Pushes to `main` deploy to GitHub Pages via `.github/workflows/deploy.yml`.
One-time setup: in the repo's **Settings → Pages**, set **Source** to
**GitHub Actions**. The build uses relative asset paths (`base: './'`), so
the same `dist/` also works zipped up for itch.io.
