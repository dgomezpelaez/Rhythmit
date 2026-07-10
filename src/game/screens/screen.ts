import type { Container } from 'pixi.js';
import type { Direction } from '../../core/chart';

/** Minimal screen contract — deliberately not a scene framework. */
export interface Screen {
  readonly view: Container;
  enter(): void;
  exit(): void;
  /** Called every rendered frame. All timing comes from the Conductor. */
  update(): void;
  /**
   * Rhythm input (space/arrows/click). audioTimeMs is the audio-clock input
   * time (AudioClock.eventTimeToAudioMs); screens convert to song time via
   * conductor.toSongTimeMs before any beat/note math.
   */
  onTap?(audioTimeMs: number): void;
  /** Directional input (arrows). Preferred over onTap when present. */
  onDir?(dir: Direction, audioTimeMs: number): void;
}
