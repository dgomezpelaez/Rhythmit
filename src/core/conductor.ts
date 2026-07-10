/**
 * Conductor — owns playback scheduling and is the authority on song time.
 *
 * songTimeMs() is derived exclusively from AudioContext.currentTime relative
 * to a recorded start time. Everything time-sensitive (visual beat markers,
 * hit judgment, note positions) reads this; nothing accumulates per frame.
 *
 * Clicks are produced with the classic lookahead pattern ("A Tale of Two
 * Clocks"): a coarse setInterval wakes up every SCHEDULER_TICK_MS and
 * schedules any beats falling inside the next LOOKAHEAD_S window at their
 * exact context time. Main-thread jitter moves the *scheduling* moment, never
 * the *audible* moment.
 */

const LEAD_IN_S = 0.2;
const SCHEDULER_TICK_MS = 25;
const LOOKAHEAD_S = 0.12;

export class Conductor {
  private startCtxTime = 0;
  private beatIntervalS = 0.5;
  private bpmValue = 120;
  private nextBeatToSchedule = 0;
  private schedulerId: number | null = null;
  private clicksEnabled = true;

  constructor(private readonly ctx: AudioContext) {}

  get running(): boolean {
    return this.schedulerId !== null;
  }

  get bpm(): number {
    return this.bpmValue;
  }

  /** Start a metronome "song": beats forever from time zero. */
  startMetronome(bpm: number, withClicks = true): void {
    this.stop();
    this.bpmValue = bpm;
    this.beatIntervalS = 60 / bpm;
    this.clicksEnabled = withClicks;
    this.startCtxTime = this.ctx.currentTime + LEAD_IN_S;
    this.nextBeatToSchedule = 0;
    this.schedulerId = window.setInterval(
      () => this.scheduleAhead(),
      SCHEDULER_TICK_MS,
    );
    this.scheduleAhead();
  }

  stop(): void {
    if (this.schedulerId !== null) {
      clearInterval(this.schedulerId);
      this.schedulerId = null;
    }
  }

  /** Song time in ms. Negative during the lead-in, before beat 0. */
  songTimeMs(): number {
    return (this.ctx.currentTime - this.startCtxTime) * 1000;
  }

  /** Fractional beat index at a song time (default: now). */
  beatAt(timeMs = this.songTimeMs()): number {
    return timeMs / 1000 / this.beatIntervalS;
  }

  /** Song time of the beat nearest to timeMs. */
  nearestBeatMs(timeMs: number): number {
    return Math.round(this.beatAt(timeMs)) * this.beatIntervalS * 1000;
  }

  /** Song time of the first beat at or after timeMs. */
  nextBeatMs(timeMs: number): number {
    return Math.ceil(this.beatAt(timeMs)) * this.beatIntervalS * 1000;
  }

  private scheduleAhead(): void {
    const horizon = this.ctx.currentTime + LOOKAHEAD_S;
    while (true) {
      const beatCtxTime =
        this.startCtxTime + this.nextBeatToSchedule * this.beatIntervalS;
      if (beatCtxTime > horizon) break;
      if (this.clicksEnabled && beatCtxTime >= this.ctx.currentTime) {
        const isDownbeat = this.nextBeatToSchedule % 4 === 0;
        this.scheduleClick(beatCtxTime, isDownbeat ? 1320 : 880);
      }
      this.nextBeatToSchedule += 1;
    }
  }

  private scheduleClick(atCtxTime: number, frequency: number): void {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.12, atCtxTime);
    gain.gain.exponentialRampToValueAtTime(0.001, atCtxTime + 0.05);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(atCtxTime);
    osc.stop(atCtxTime + 0.05);
  }
}
