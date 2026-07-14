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

## Current state (Phase 6 — auto-charting)

Click/press any key to start audio, then:

- **Song select is home**: pick a song (`↑/↓` + `Enter`), then a monster —
  both lists show built-in and modded content side by side, with a live idle
  preview on the monster screen. Selections persist across sessions.
- **Feed it any song — drop an MP3/OGG/WAV anywhere on the window** and it
  becomes playable: the audio is analyzed in a Web Worker (per-band spectral
  flux onset detection with a progress bar) and three charts are generated —
  easy, normal, hard. Kicks and bass hits land on `↓`, snares and vocals
  alternate `←`/`→`, hi-hats and cymbals ride on `↑`. BPM and beat phase are
  estimated for the downbeat effects. Results are cached in IndexedDB keyed
  by the file's content hash — re-dropping the same file (or reloading) is
  instant, and generated songs are removed from the Mods panel like mods.
  Expect "pretty good, not hand-crafted" charts; an in-game editor for
  perfectionists is a later phase.
- **Mods — drop a folder or .zip anywhere on the window** (or press **`M`**
  for the Mods panel and its `.zip` picker). Mods are validated on the spot;
  every problem is reported with the exact file and field ("`chompo.json:
  animation 'chomp_left' missing`"), and valid mods are stored in IndexedDB
  so they survive reloads. Re-drop the same mod id to update it; remove from
  the panel. A complete generated example lives in
  [`examples/sample-mod/`](examples/sample-mod/) (the Blobby monster, the
  Bounce song, the Pepper food) and the full format reference is
  [`MODDING.md`](MODDING.md): songs (chart + audio), characters
  (spritesheet + JSON) and custom **foods** (sprite + splat color) — all
  plain files, zero code, no build step.
- **Gameplay**: food flies at the monster from four directions; press the
  matching **arrow key** as it reaches the mouth. The built-in 30-second
  test song (128 BPM synth groove, 72 notes) ships as before.
  Timing grades: Perfect ±45 ms · Good ±90 ms · Okay ±135 ms · else Miss.
  Score, combo and accuracy in the HUD.
  **`R`** — instant retry. **`Esc`** — back to song select.
- **Chompo reacts to everything**: directional chomps (perfects chain into a
  starry-eyed flourish), splats on misses, escalating expressions at combo
  10/25 and fever mode at 50, and its eyes track the nearest incoming food.
  Misses drain the **hunger bar** — empty means a comedic KO collapse.
  Chompo is defined entirely by the `character.json` contract (spritesheet
  grid + JSON, zero code); its sheet and voice clips are generated at
  runtime, so a real art pass is a drop-in replacement.
- **Hits feel like hits**: a Perfect freezes the picture for 2–3 frames
  (audio never pauses — only the visual clock clamps), food-colored
  particle bursts scale with the judgment, floating labels pop in, and the
  whole play field breathes subtly on every downbeat.
- **Misses stay funny**: missed food *splats onto Chompo's face and stays
  there*, piling up over the song. Clear the song for a celebration with
  beat-synced confetti; starve to zero for a KO with a splat-rain finale.
- **Results & share card**: letter grade (S/A/B/C — a full combo lowers the
  S bar), accuracy, max combo, per-judgment counts, and one-tap **save /
  copy** of a 1200×630 share card showing the monster's actual final state —
  glorious or food-covered.
- **`B`** — metronome screen: 120 BPM clicks with a puck that lands on the
  hit line every beat — the drift test. Tap `space`/click on the beat to
  see your timing error in ms.
- **`C`** — latency calibration: tap along at 90 BPM (4 warm-up + 12 counted
  taps); the average offset is stored in localStorage and applied to all
  future input. `Esc` cancels.
- **`D`** — toggle the debug overlay (audio/song time, beat, next note, hit
  error, calibration offset, FPS).

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
