import { Container, Graphics, Text } from 'pixi.js';
import type { Conductor } from '../../engine';
import { saveCalibrationOffsetMs } from '../settings';
import type { Screen } from './screen';

const BPM = 90;
const WARMUP_TAPS = 4;
const COUNTED_TAPS = 12;
const OUTLIER_MS = 250;

/**
 * Latency calibration: the player taps along with a metronome; the average
 * signed error is stored as the offset applied to all future input
 * timestamps. Audio OUTPUT latency is compensated automatically (see
 * Conductor.outputLatencyMs and the subtraction below), so what this screen
 * measures is only input latency + human bias. Offsets saved before that
 * compensation existed double-count output latency (10–40 ms on wired
 * devices — within the Perfect window); re-calibrating once fixes it.
 */
export class CalibrationScreen implements Screen {
  readonly view = new Container();
  private readonly status: Text;
  private readonly lastTap: Text;
  private readonly pulse: Graphics;
  private deltas: number[] = [];
  private tapCount = 0;
  private done = false;

  constructor(
    private readonly conductor: Conductor,
    private readonly onDone: () => void,
    stageWidth: number,
    stageHeight: number,
  ) {
    const cx = stageWidth / 2;
    const cy = stageHeight / 2;

    this.pulse = new Graphics().circle(0, 0, 60).stroke({
      width: 5,
      color: '#66d9ff',
    });
    this.pulse.position.set(cx, cy);
    this.view.addChild(this.pulse);

    const title = new Text({
      text: 'calibration — tap space on every click',
      style: { fill: '#ffffff', fontSize: 22, fontWeight: 'bold' },
    });
    title.anchor.set(0.5);
    title.position.set(cx, 80);
    this.view.addChild(title);

    this.status = new Text({
      text: '',
      style: { fill: '#9a9ab0', fontSize: 18 },
    });
    this.status.anchor.set(0.5);
    this.status.position.set(cx, cy + 130);
    this.view.addChild(this.status);

    this.lastTap = new Text({
      text: '',
      style: { fill: '#ffd166', fontSize: 26, fontWeight: 'bold' },
    });
    this.lastTap.anchor.set(0.5);
    this.lastTap.position.set(cx, cy - 130);
    this.view.addChild(this.lastTap);
  }

  enter(): void {
    this.deltas = [];
    this.tapCount = 0;
    this.done = false;
    this.lastTap.text = '';
    this.conductor.startMetronome(BPM);
  }

  exit(): void {
    this.conductor.stop();
  }

  update(): void {
    // Display clock: pulse when the click is heard.
    const phase =
      ((this.conductor.beatAt(this.conductor.displayTimeMs()) % 1) + 1) % 1;
    const decay = Math.max(0, 1 - phase / 0.3);
    this.pulse.alpha = 0.25 + 0.75 * decay;
    this.pulse.scale.set(1 + 0.25 * (1 - decay));

    if (!this.done) {
      const remainingWarmup = WARMUP_TAPS - this.tapCount;
      this.status.text =
        remainingWarmup > 0
          ? `warm-up: ${remainingWarmup} tap${remainingWarmup === 1 ? '' : 's'} to go (not counted)`
          : `counted taps: ${this.deltas.length}/${COUNTED_TAPS} · Esc to cancel`;
    }
  }

  onTap(audioTimeMs: number): void {
    if (this.done) return;

    // Song-clock delta vs the actual beat grid; no calibration subtraction
    // (inputTimeMs default 0) — this screen is the one measuring that offset.
    const songMs = this.conductor.inputTimeMs(audioTimeMs);
    const delta = songMs - this.conductor.nearestBeatMs(songMs);
    this.tapCount += 1;
    this.lastTap.text = `${delta > 0 ? '+' : ''}${delta.toFixed(0)} ms`;

    const isWarmup = this.tapCount <= WARMUP_TAPS;
    if (!isWarmup && Math.abs(delta) <= OUTLIER_MS) {
      this.deltas.push(delta);
    }

    if (this.deltas.length >= COUNTED_TAPS) {
      const offset =
        this.deltas.reduce((sum, d) => sum + d, 0) / this.deltas.length;
      saveCalibrationOffsetMs(offset);
      this.done = true;
      this.conductor.stop();
      this.status.text = `saved offset: ${offset.toFixed(0)} ms — returning…`;
      setTimeout(() => this.onDone(), 1500);
    }
  }
}
