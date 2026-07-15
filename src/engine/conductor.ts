/**
 * Conductor — owns playback scheduling and is the authority on song time.
 *
 * songTimeMs() is derived exclusively from AudioContext.currentTime relative
 * to a recorded start time. Everything time-sensitive (visual beat markers,
 * note positions, hit judgment) reads this; nothing accumulates per frame.
 *
 * Metronome clicks are produced with the classic lookahead pattern ("A Tale
 * of Two Clocks"): a coarse setInterval wakes up every SCHEDULER_TICK_MS and
 * schedules any beats falling inside the next LOOKAHEAD_S window at their
 * exact context time. Main-thread jitter moves the *scheduling* moment, never
 * the *audible* moment. Songs are AudioBufferSourceNodes started at the same
 * recorded start time, so the identical clock covers both modes.
 */

const LEAD_IN_S = 0.2;
const SCHEDULER_TICK_MS = 25;
const LOOKAHEAD_S = 0.12;

type Mode = 'idle' | 'metronome' | 'song';

export class Conductor {
  private mode: Mode = 'idle';
  private startCtxTime = 0;
  private beatIntervalS = 0.5;
  private bpmValue = 120;
  private offsetMsValue = 0;
  private songDurationMs = Infinity;
  private nextBeatToSchedule = 0;
  private schedulerId: number | null = null;
  private source: AudioBufferSourceNode | null = null;
  private outputLatencyMsValue = 0;
  private lastLatencyPollCtxS = -Infinity;

  constructor(private readonly ctx: AudioContext) {}

  get running(): boolean {
    return this.mode !== 'idle';
  }

  get bpm(): number {
    return this.bpmValue;
  }

  get durationMs(): number {
    return this.songDurationMs;
  }

  /** Start a metronome "song": clicked beats forever from time zero. */
  startMetronome(bpm: number): void {
    this.stop();
    this.mode = 'metronome';
    this.configure(bpm, 0, Infinity);
    this.nextBeatToSchedule = 0;
    this.schedulerId = window.setInterval(
      () => this.scheduleAhead(),
      SCHEDULER_TICK_MS,
    );
    this.scheduleAhead();
  }

  /** Play an audio buffer as the song. Beat math uses bpm + chart offsetMs. */
  startSong(buffer: AudioBuffer, bpm: number, offsetMs: number): void {
    this.stop();
    this.mode = 'song';
    this.configure(bpm, offsetMs, buffer.duration * 1000);
    this.source = this.ctx.createBufferSource();
    this.source.buffer = buffer;
    this.source.connect(this.ctx.destination);
    this.source.start(this.startCtxTime);
  }

  stop(): void {
    if (this.schedulerId !== null) {
      clearInterval(this.schedulerId);
      this.schedulerId = null;
    }
    if (this.source) {
      try {
        this.source.stop();
      } catch {
        // Not started yet or already stopped — either way it's gone.
      }
      this.source.disconnect();
      this.source = null;
    }
    this.mode = 'idle';
  }

  private configure(bpm: number, offsetMs: number, durationMs: number): void {
    this.bpmValue = bpm;
    this.beatIntervalS = 60 / bpm;
    this.offsetMsValue = offsetMs;
    this.songDurationMs = durationMs;
    this.startCtxTime = this.ctx.currentTime + LEAD_IN_S;
  }

  /** Song time in ms. Negative during the lead-in, before time zero. */
  songTimeMs(): number {
    return (this.ctx.currentTime - this.startCtxTime) * 1000;
  }

  /**
   * Estimated delay between ctx.currentTime and the sound reaching the ear.
   * This is a display/judgment offset, NOT a second clock — all timing still
   * derives solely from AudioContext.currentTime; this only shifts where
   * "now" is drawn and how input timestamps map onto the chart. Polled at
   * most once per second: outputLatency changes when output devices switch,
   * and is 0/undefined in some browsers.
   */
  outputLatencyMs(): number {
    const nowS = this.ctx.currentTime;
    if (nowS - this.lastLatencyPollCtxS >= 1) {
      this.lastLatencyPollCtxS = nowS;
      // `||` not `??`: a reported 0 falls through to the next estimate.
      const rawS = this.ctx.outputLatency || this.ctx.baseLatency || 0;
      const ms = Number.isFinite(rawS) ? rawS * 1000 : 0;
      this.outputLatencyMsValue = Math.min(500, Math.max(0, ms));
    }
    return this.outputLatencyMsValue;
  }

  /** Song time as the player perceives it (audible "now"). Render to this. */
  displayTimeMs(): number {
    return this.songTimeMs() - this.outputLatencyMs();
  }

  /** Map an absolute audio-clock time (AudioClock ms) to song time. */
  toSongTimeMs(audioTimeMs: number): number {
    return audioTimeMs - this.startCtxTime * 1000;
  }

  get ended(): boolean {
    return this.mode === 'song' && this.songTimeMs() >= this.songDurationMs;
  }

  /** Fractional beat index at a song time (default: now). */
  beatAt(timeMs = this.songTimeMs()): number {
    return (timeMs - this.offsetMsValue) / 1000 / this.beatIntervalS;
  }

  /** Song time of the beat nearest to timeMs. */
  nearestBeatMs(timeMs: number): number {
    return (
      Math.round(this.beatAt(timeMs)) * this.beatIntervalS * 1000 +
      this.offsetMsValue
    );
  }

  /** Song time of the first beat at or after timeMs. */
  nextBeatMs(timeMs: number): number {
    return (
      Math.ceil(this.beatAt(timeMs)) * this.beatIntervalS * 1000 +
      this.offsetMsValue
    );
  }

  private scheduleAhead(): void {
    const horizon = this.ctx.currentTime + LOOKAHEAD_S;
    while (true) {
      const beatCtxTime =
        this.startCtxTime + this.nextBeatToSchedule * this.beatIntervalS;
      if (beatCtxTime > horizon) break;
      if (beatCtxTime >= this.ctx.currentTime) {
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
