/**
 * Hitstop — a brief freeze-frame for impact, done the only way the timing
 * architecture allows: by clamping the *visual* clock. Audio and judgment
 * keep reading real song time; every visual subsystem reads visualMs()
 * instead. While a stop is active visualMs() holds at the trigger moment,
 * then snaps back to true time — at 2–3 frames the jump is imperceptible,
 * and visuals stay pure functions of time (nothing accumulates).
 */

const DEFAULT_DURATION_MS = 40;

export class Hitstop {
  private startMs: number | null = null;

  constructor(private readonly durationMs = DEFAULT_DURATION_MS) {}

  trigger(nowMs: number): void {
    this.startMs = nowMs;
  }

  /** The time visuals should render at: clamped during a stop. */
  visualMs(nowMs: number): number {
    if (this.startMs === null) return nowMs;
    if (nowMs >= this.startMs + this.durationMs) {
      this.startMs = null;
      return nowMs;
    }
    return this.startMs;
  }

  reset(): void {
    this.startMs = null;
  }
}
