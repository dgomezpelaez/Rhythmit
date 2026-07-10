import { Application, Graphics } from 'pixi.js';
import { AudioClock } from './core/audio';
import { startRenderLoop } from './core/loop';

const STAGE_WIDTH = 960;
const STAGE_HEIGHT = 540;

async function bootstrap(): Promise<void> {
  const app = new Application();
  await app.init({
    width: STAGE_WIDTH,
    height: STAGE_HEIGHT,
    background: '#1a1a24',
    antialias: true,
  });
  // Pixi's ticker would render on its own; we drive rendering from our
  // explicit loop instead so there is exactly one place rAF is used.
  app.ticker.stop();

  document.querySelector('#stage')!.appendChild(app.canvas);

  const rect = new Graphics().rect(-60, -60, 120, 120).fill('#ff5c8a');
  rect.position.set(STAGE_WIDTH / 2, STAGE_HEIGHT / 2);
  app.stage.addChild(rect);

  const clock = new AudioClock();
  const hint = document.querySelector('#audio-hint')!;
  const debug = document.querySelector('#debug')!;

  const unlock = async () => {
    await clock.unlock();
    clock.playBeep();
    hint.classList.add('hidden');
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  startRenderLoop((rafTimeMs) => {
    // rAF time is used for cosmetic animation only.
    const t = rafTimeMs / 1000;
    rect.rotation = t;
    const pulse = 1 + 0.15 * Math.sin(t * 4);
    rect.scale.set(pulse);

    const audioMs = clock.nowMs();
    debug.textContent =
      audioMs === null
        ? 'audio: locked (awaiting gesture)'
        : `audio: ${(audioMs / 1000).toFixed(3)}s`;

    app.renderer.render(app.stage);
  });
}

void bootstrap();
