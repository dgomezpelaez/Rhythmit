import { Application } from 'pixi.js';
import { AudioClock } from './core/audio';
import { parseChart, type Chart, type Direction } from './core/chart';
import { Conductor } from './core/conductor';
import { startRenderLoop } from './core/loop';
import { loadCalibrationOffsetMs } from './core/settings';
import { buildChompo } from './game/monster/chompo';
import { CalibrationScreen } from './game/screens/calibration';
import { GameplayScreen } from './game/screens/gameplay';
import { MetronomeScreen } from './game/screens/metronome';
import type { Screen } from './game/screens/screen';
import { synthesizeTestTrack } from './game/testtrack';

const STAGE_WIDTH = 960;
const STAGE_HEIGHT = 540;

const DIR_KEYS: Record<string, Direction> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

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
  let gameplay: GameplayScreen | null = null;
  let gameplayLoading = false;
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

  /** Lazy-load the test song and default monster on first play. */
  const enterGameplay = async () => {
    if (gameplayLoading) return;
    if (!gameplay) {
      gameplayLoading = true;
      try {
        const response = await fetch('songs/test/chart.json');
        if (!response.ok) {
          throw new Error(`chart fetch failed: HTTP ${response.status}`);
        }
        const chart: Chart = parseChart(await response.json());
        const [buffer, character] = await Promise.all([
          synthesizeTestTrack(),
          buildChompo(),
        ]);
        gameplay = new GameplayScreen(
          conductor!,
          chart,
          buffer,
          character,
          clock.context,
          STAGE_WIDTH,
          STAGE_HEIGHT,
        );
      } finally {
        gameplayLoading = false;
      }
    }
    switchTo(gameplay);
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

  window.addEventListener('keydown', (e) => {
    if (!current) return;
    const dir = DIR_KEYS[e.code];
    if (dir && current.onDir) {
      const timeMs = clock.eventTimeToAudioMs(e);
      if (timeMs !== null) current.onDir(dir, timeMs);
      e.preventDefault();
    } else if ((dir || e.code === 'Space') && current.onTap) {
      const timeMs = clock.eventTimeToAudioMs(e);
      if (timeMs !== null) current.onTap(timeMs);
      e.preventDefault();
    } else if (e.code === 'Enter' && current === metronome) {
      void enterGameplay();
    } else if (e.code === 'KeyC' && current === metronome) {
      switchTo(calibration!);
    } else if (e.code === 'KeyR' && current === gameplay) {
      switchTo(gameplay!); // exit + enter = instant restart
    } else if (e.code === 'Escape' && current !== metronome) {
      switchTo(metronome!);
    } else if (e.code === 'KeyD') {
      debugVisible = !debugVisible;
      debug.style.display = debugVisible ? 'block' : 'none';
    }
  });
  window.addEventListener('pointerdown', (e) => {
    if (current?.onTap) {
      const timeMs = clock.eventTimeToAudioMs(e);
      if (timeMs !== null) current.onTap(timeMs);
    }
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
        const lines = [
          `audio    ${(audioMs / 1000).toFixed(3)}s`,
          `song     ${(songMs / 1000).toFixed(3)}s`,
          `beat     ${Math.floor(conductor.beatAt(songMs))} @ ${conductor.bpm} BPM`,
        ];
        if (current === gameplay && gameplay) {
          lines.push(
            `next     ${gameplay.nextNoteLabel()}`,
            `hit err  ${gameplay.lastErrorMs?.toFixed(0) ?? '—'} ms`,
            `judged   ${gameplay.judgedLabel()}`,
          );
        } else {
          lines.push(`tap err  ${metronome?.lastErrorMs?.toFixed(0) ?? '—'} ms`);
        }
        lines.push(
          `cal off  ${loadCalibrationOffsetMs()} ms`,
          `fps      ${(1000 / frameMsEma).toFixed(0)}`,
        );
        debug.textContent = lines.join('\n');
      } else {
        debug.textContent = `audio    ${(audioMs / 1000).toFixed(3)}s`;
      }
    }

    app.renderer.render(app.stage);
  });
}

void bootstrap();
