import { Container, Graphics, Text } from 'pixi.js';
import type { Conductor } from '../../engine/conductor';
import { loadCalibrationOffsetMs } from '../settings';
import type { Screen } from './screen';

const BPM = 120;
const TRAVEL_PX = 320;

/**
 * Drift-test screen: a puck slides into a fixed hit-line once per beat and a
 * ring pulses on the beat. Both are pure functions of conductor.songTimeMs(),
 * so if the audible click and the visuals ever separate, the clock is wrong —
 * that is exactly what this screen exists to expose.
 */
export class MetronomeScreen implements Screen {
  readonly view = new Container();
  private readonly puck: Graphics;
  private readonly pulse: Graphics;
  private readonly tapText: Text;
  private readonly cx: number;
  private lastTapErrorMs: number | null = null;

  constructor(
    private readonly conductor: Conductor,
    stageWidth: number,
    stageHeight: number,
  ) {
    this.cx = stageWidth / 2;
    const cy = stageHeight / 2;

    const hitLine = new Graphics()
      .rect(this.cx - 2, cy - 70, 4, 140)
      .fill('#5f6f76');
    this.view.addChild(hitLine);

    this.pulse = new Graphics().circle(0, 0, 46).stroke({
      width: 4,
      color: '#ff5c8a',
    });
    this.pulse.position.set(this.cx, cy);
    this.view.addChild(this.pulse);

    this.puck = new Graphics().circle(0, 0, 24).fill('#ffd166');
    this.puck.position.set(this.cx, cy);
    this.view.addChild(this.puck);

    const help = new Text({
      text: `metronome ${BPM} BPM — tap space/click on the beat · Enter = play · C = calibrate`,
      style: { fill: '#9a9ab0', fontSize: 16 },
    });
    help.anchor.set(0.5, 0);
    help.position.set(this.cx, stageHeight - 48);
    this.view.addChild(help);

    this.tapText = new Text({
      text: '',
      style: { fill: '#ffffff', fontSize: 28, fontWeight: 'bold' },
    });
    this.tapText.anchor.set(0.5);
    this.tapText.position.set(this.cx, cy - 120);
    this.view.addChild(this.tapText);
  }

  enter(): void {
    this.conductor.startMetronome(BPM);
  }

  exit(): void {
    this.conductor.stop();
  }

  update(): void {
    // Display clock: the puck lands when the click is HEARD, not when the
    // context schedules it.
    const beat = this.conductor.beatAt(this.conductor.displayTimeMs());
    // Phase within the current beat: 0 = on the beat, →1 = next beat.
    const phase = ((beat % 1) + 1) % 1;

    // Puck slides in from the left across one beat and reaches the hit line
    // exactly on the beat (phase wraps to 0 = landed), then resets. Position
    // is a pure function of song time — never incremented per frame.
    this.puck.x = this.cx - TRAVEL_PX * (1 - phase);

    // Ring pops on the beat and decays over the first 30% of the beat.
    const decay = Math.max(0, 1 - phase / 0.3);
    this.pulse.alpha = decay;
    this.pulse.scale.set(1 + 0.4 * (1 - decay));

    if (this.lastTapErrorMs !== null) {
      const e = this.lastTapErrorMs;
      this.tapText.text = `${e > 0 ? '+' : ''}${e.toFixed(0)} ms`;
      this.tapText.style.fill =
        Math.abs(e) <= 45 ? '#7cff6b' : Math.abs(e) <= 90 ? '#ffd166' : '#ff6b6b';
    }
  }

  onTap(audioTimeMs: number): void {
    // The beat grid lives on the song clock; inputTimeMs applies the same
    // latency + calibration correction gameplay judges input with.
    const songMs = this.conductor.inputTimeMs(
      audioTimeMs,
      loadCalibrationOffsetMs(),
    );
    this.lastTapErrorMs = songMs - this.conductor.nearestBeatMs(songMs);
  }

  get lastErrorMs(): number | null {
    return this.lastTapErrorMs;
  }
}
