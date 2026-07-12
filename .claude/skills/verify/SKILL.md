---
name: verify
description: Build, launch, and drive Monster Feeder headless to verify gameplay changes end-to-end.
---

# Verifying Monster Feeder

Browser game (PixiJS + Web Audio). No test framework; `npm run build` is only
the type gate. Real verification = drive it in a browser.

## Launch

```sh
npm install            # fresh containers have no node_modules
npm run dev -- --port 5173 --strictPort   # background it
```

## Drive headless (Playwright)

Works fully headless — Web Audio advances in headless Chromium. Launch with
the pre-installed browser and autoplay flag:

```js
chromium.launch({
  headless: true,
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--autoplay-policy=no-user-gesture-required'],
});
```

Flow: `goto` → `keyboard.press('KeyA')` unlocks audio (any key) → metronome
screen → `Enter` starts gameplay (test song ~30 s, 72 notes, 128 BPM) →
`R` retries, `Esc` returns to menu.

Synthetic `KeyboardEvent`s dispatched from page context ARE judged correctly
(`eventTimeToAudioMs` maps `e.timeStamp`; nothing checks `isTrusted`), so an
in-page autoplayer works: poll the `#debug` overlay text each ~4 ms for
`next <dir> in <N>ms` and dispatch the matching `Arrow*` when N ≤ 20. This
yields mostly Perfects (hit err ±10 ms). Stop pressing to accumulate misses;
7 misses ⇒ hunger empty ⇒ KO.

The `#debug` overlay (toggle `D`, on by default) is the observation seam:
song time, beat, next note, hit error, judged count, FPS.

## Gotchas

- Downloads: use Playwright's `download` event when clicking `#btn-save`.
- Clipboard: `context({ permissions: ['clipboard-write', 'clipboard-read'] })`
  then `navigator.clipboard.read()` in page context to verify the copied PNG.
- Headless uses SwiftShader — FPS ~40–60 is normal, not a perf regression.
