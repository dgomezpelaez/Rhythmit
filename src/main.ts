import { Application } from 'pixi.js';
import { AudioClock } from './core/audio';
import { Conductor } from './core/conductor';
import { startRenderLoop } from './core/loop';
import { loadCalibrationOffsetMs } from './core/settings';
import { CalibrationScreen } from './game/screens/calibration';
import { MetronomeScreen } from './game/screens/metronome';
import type { Screen } from './game/screens/screen';

const STAGE_WIDTH = 960;
const STAGE_HEIGHT = 540;

const TAP_KEYS = new Set([
  'Space',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
]);

async function bootstrap(): Promise<void> {
  const app = new Application();
  await app.init({
    width: STAGE_WIDTH,
    height: STAGE_HEIGHT,
    background: '#1a1a24',
    antialias: true,
  });
  // We drive rendering from our explicit rAF loop; keep exactly one rAF user.
  app.ticker.stop();
  document.querySelector('#stage')!.appendChild(app.canvas);

  const clock = new AudioClock();
  const hint = document.querySelector('#audio-hint')!;
  const debug = document.querySelector('#debug') as HTMLElement;

  let conductor: Conductor | null = null;
  let metronome: MetronomeScreen | null = null;
  let calibration: CalibrationScreen | null = null;
  let current: Screen | null = null;
  let debugVisible = true;

  const switchTo = (next: Screen) => {
    if (current) {
      current.exit();
      app.stage.removeChild(current.view);
    }
    current = next;
    app.stage.addChild(next.view);
    next.enter();
  };

  const startGame = () => {
    conductor = new Conductor(clock.context);
    metronome = new MetronomeScreen(conductor, STAGE_WIDTH, STAGE_HEIGHT);
    calibration = new CalibrationScreen(
      conductor,
      () => switchTo(metronome!),
      STAGE_WIDTH,
      STAGE_HEIGHT,
    );
    switchTo(metronome);
  };

  const unlock = async (e: Event) => {
    await clock.unlock();
    hint.classList.add('hidden');
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    startGame();
    e.preventDefault();
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  const tap = (e: Event) => {
    const timeMs = clock.eventTimeToAudioMs(e);
    if (timeMs !== null && current?.onTap) current.onTap(timeMs);
  };

  window.addEventListener('keydown', (e) => {
    if (!current) return;
    if (TAP_KEYS.has(e.code)) {
      tap(e);
      e.preventDefault();
    } else if (e.code === 'KeyC' && current === metronome) {
      switchTo(calibration!);
    } else if (e.code === 'Escape' && current === calibration) {
      switchTo(metronome!);
    } else if (e.code === 'KeyD') {
      debugVisible = !debugVisible;
      debug.style.display = debugVisible ? 'block' : 'none';
    }
  });
  window.addEventListener('pointerdown', (e) => {
    if (current) tap(e);
  });

  // FPS as an exponential moving average of frame time.
  let lastRaf = 0;
  let frameMsEma = 16.7;

  startRenderLoop((rafTimeMs) => {
    if (lastRaf > 0) {
      frameMsEma += ((rafTimeMs - lastRaf) - frameMsEma) * 0.05;
    }
    lastRaf = rafTimeMs;

    current?.update();

    if (debugVisible) {
      const audioMs = clock.nowMs();
      if (audioMs === null) {
        debug.textContent = 'audio: locked (awaiting gesture)';
      } else if (conductor?.running) {
        const songMs = conductor.songTimeMs();
        debug.textContent = [
          `audio    ${(audioMs / 1000).toFixed(3)}s`,
          `song     ${(songMs / 1000).toFixed(3)}s`,
          `beat     ${Math.floor(conductor.beatAt(songMs))} @ ${conductor.bpm} BPM`,
          `tap err  ${metronome?.lastErrorMs?.toFixed(0) ?? '—'} ms`,
          `cal off  ${loadCalibrationOffsetMs()} ms`,
          `fps      ${(1000 / frameMsEma).toFixed(0)}`,
        ].join('\n');
      } else {
        debug.textContent = `audio    ${(audioMs / 1000).toFixed(3)}s`;
      }
    }

    app.renderer.render(app.stage);
  });
}

void bootstrap();
