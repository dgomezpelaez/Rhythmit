import type { Container } from 'pixi.js';

/** Minimal screen contract — deliberately not a scene framework. */
export interface Screen {
  readonly view: Container;
  enter(): void;
  exit(): void;
  /** Called every rendered frame. All timing comes from the Conductor. */
  update(): void;
  /** Rhythm input (space/arrows/click). timeMs is audio-mapped input time. */
  onTap?(timeMs: number): void;
}
