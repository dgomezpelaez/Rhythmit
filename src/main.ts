import { Application } from 'pixi.js';
import { AudioClock } from './core/audio';
import { parseChart, type Direction } from './core/chart';
import { Conductor } from './core/conductor';
import { startRenderLoop } from './core/loop';
import { loadCalibrationOffsetMs } from './core/settings';
import { buildChompo } from './game/monster/chompo';
import { CalibrationScreen } from './game/screens/calibration';
import { CharacterSelectScreen } from './game/screens/charselect';
import { GameplayScreen } from './game/screens/gameplay';
import { MetronomeScreen } from './game/screens/metronome';
import type { Screen } from './game/screens/screen';
import { SongSelectScreen } from './game/screens/songselect';
import { idbGetAllMods } from './mods/db';
import { initModPanel, summarize } from './mods/panel';
import { ContentRegistry, type CharacterEntry, type SongEntry } from './mods/registry';
import { validateMod } from './mods/validate';
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
  let songSelect: SongSelectScreen | null = null;
  let charSelect: CharacterSelectScreen | null = null;
  let gameplay: GameplayScreen | null = null;
  let gameplayFor: string | null = null;
  let gameplayLoading = false;
  let pickedSong: SongEntry | null = null;
  let current: Screen | null = null;
  let debugVisible = true;
  let modPanel: { toggle(): void; setVisible(v: boolean): void } | null = null;

  const registry = new ContentRegistry();

  const switchTo = (next: Screen) => {
    if (current) {
      current.exit();
      app.stage.removeChild(current.view);
    }
    current = next;
    app.stage.addChild(next.view);
    next.enter();
  };

  /** Decode + slice the pair on demand, then start (or restart) gameplay. */
  const enterGameplay = async (song: SongEntry, character: CharacterEntry) => {
    if (gameplayLoading) return;
    const pairKey = `${song.id}|${character.id}`;
    if (!gameplay || gameplayFor !== pairKey) {
      gameplayLoading = true;
      try {
        const ctx = clock.context;
        const [buffer, loaded, foods] = await Promise.all([
          song.loadAudio(ctx),
          character.load(ctx),
          registry.buildChartFoods(song),
        ]);
        if (gameplay) {
          if (current === gameplay) switchTo(songSelect!);
          gameplay.view.destroy({ children: true });
        }
        gameplay = new GameplayScreen(
          conductor!,
          song.chart,
          buffer,
          loaded,
          foods,
          ctx,
          app.renderer,
          STAGE_WIDTH,
          STAGE_HEIGHT,
        );
        gameplayFor = pairKey;
      } catch (e) {
        console.error('failed to start song', e);
        return;
      } finally {
        gameplayLoading = false;
      }
    }
    switchTo(gameplay);
  };

  const startGame = async () => {
    conductor = new Conductor(clock.context);

    // Built-in content flows through the same registry mods use.
    try {
      const response = await fetch('songs/test/chart.json');
      if (!response.ok) {
        throw new Error(`chart fetch failed: HTTP ${response.status}`);
      }
      registry.registerBuiltInSong({
        key: 'test',
        chart: parseChart(await response.json()),
        loadAudio: () => synthesizeTestTrack(),
      });
    } catch (e) {
      console.error('built-in song failed to load', e);
    }
    registry.registerBuiltInCharacter({
      key: 'chompo',
      name: 'Chompo',
      load: () => buildChompo(),
    });

    songSelect = new SongSelectScreen(
      registry,
      (song) => {
        pickedSong = song;
        switchTo(charSelect!);
      },
      STAGE_WIDTH,
      STAGE_HEIGHT,
    );
    charSelect = new CharacterSelectScreen(
      registry,
      clock.context,
      (character) => {
        if (pickedSong) void enterGameplay(pickedSong, character);
      },
      STAGE_WIDTH,
      STAGE_HEIGHT,
    );
    metronome = new MetronomeScreen(conductor, STAGE_WIDTH, STAGE_HEIGHT);
    calibration = new CalibrationScreen(
      conductor,
      () => switchTo(songSelect!),
      STAGE_WIDTH,
      STAGE_HEIGHT,
    );

    // Installed mods: load from IndexedDB, re-check shape (assets were
    // decode-verified at import), register. Failures skip the mod but boot on.
    const bootErrors: string[] = [];
    let persistent = true;
    let stored: Awaited<ReturnType<typeof idbGetAllMods>> = [];
    try {
      stored = await idbGetAllMods();
    } catch (e) {
      console.error('IndexedDB unavailable; mods will not persist', e);
      persistent = false;
    }

    const panel = initModPanel({
      registry,
      audio: clock.context,
      persistent,
      onContentChanged: () => {
        songSelect?.refresh();
        charSelect?.refresh();
      },
    });
    modPanel = panel;

    const installedRows: { id: string; name: string; summary: string }[] = [];
    for (const mod of stored.sort((a, b) => a.addedAt - b.addedAt)) {
      const files = new Map(Object.entries(mod.files));
      const result = await validateMod(files, clock.context, {
        decodeAssets: false,
      });
      if (result.ok) {
        registry.registerMod(result.parsed, files);
        installedRows.push({
          id: mod.id,
          name: mod.manifest.name,
          summary: summarize(result.parsed),
        });
      } else {
        bootErrors.push(
          `stored mod "${mod.manifest.name}" failed to load: ${result.errors[0]}`,
        );
        console.error('stored mod failed to load', mod.id, result.errors);
      }
    }
    panel.refreshList(installedRows);
    if (bootErrors.length > 0) {
      const status = document.querySelector('#mod-status');
      if (status) status.textContent = bootErrors[0]!;
      panel.setVisible(true);
    }

    songSelect.refresh();
    switchTo(songSelect);
  };

  const unlock = async (e: Event) => {
    await clock.unlock();
    hint.classList.add('hidden');
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    void startGame();
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
    } else if (e.code === 'Enter' && current.onConfirm) {
      current.onConfirm();
    } else if (e.code === 'KeyC' && current === songSelect) {
      switchTo(calibration!);
    } else if (e.code === 'KeyB' && current === songSelect) {
      switchTo(metronome!);
    } else if (e.code === 'KeyM' && current !== gameplay) {
      modPanel?.toggle();
    } else if (e.code === 'KeyR' && current === gameplay) {
      switchTo(gameplay!); // exit + enter = instant restart
    } else if (e.code === 'Escape') {
      if (current === gameplay || current === metronome || current === calibration) {
        switchTo(songSelect!);
      } else if (current === charSelect) {
        switchTo(songSelect!);
      }
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
      } else {
        const lines = [`audio    ${(audioMs / 1000).toFixed(3)}s`];
        if (conductor?.running) {
          const songMs = conductor.songTimeMs();
          lines.push(
            `song     ${(songMs / 1000).toFixed(3)}s`,
            `beat     ${Math.floor(conductor.beatAt(songMs))} @ ${conductor.bpm} BPM`,
          );
        }
        if (current === gameplay && gameplay) {
          lines.push(
            `next     ${gameplay.nextNoteLabel()}`,
            `hit err  ${gameplay.lastErrorMs?.toFixed(0) ?? '—'} ms`,
            `judged   ${gameplay.judgedLabel()}`,
          );
        } else if (current === metronome) {
          lines.push(`tap err  ${metronome?.lastErrorMs?.toFixed(0) ?? '—'} ms`);
        }
        if (current?.debugLabel) lines.push(current.debugLabel());
        lines.push(
          `cal off  ${loadCalibrationOffsetMs()} ms`,
          `fps      ${(1000 / frameMsEma).toFixed(0)}`,
        );
        debug.textContent = lines.join('\n');
      }
    }

    app.renderer.render(app.stage);
  });
}

void bootstrap();
