/**
 * AudioClock — owns the AudioContext and is the single source of game time.
 *
 * Hard rule for the whole project: all gameplay timing derives from
 * AudioContext.currentTime. requestAnimationFrame timestamps and Date.now()
 * drive rendering only, never judgment or scheduling.
 *
 * Browsers require a user gesture before an AudioContext may start, so the
 * context is created lazily by unlock(), which the bootstrap wires to the
 * first pointer/key event.
 */
export class AudioClock {
  private ctx: AudioContext | null = null;

  get unlocked(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** The context, for schedulers (Conductor). Only valid after unlock(). */
  get context(): AudioContext {
    if (!this.ctx) throw new Error('AudioClock not unlocked yet');
    return this.ctx;
  }

  /**
   * Map a DOM input event to audio time in ms. event.timeStamp is on the
   * performance timeline and set when the OS delivered the event, so the
   * (timeStamp − performance.now()) term subtracts main-thread handler
   * delay. Hit judgment must use this, never the time the handler ran.
   */
  eventTimeToAudioMs(e: Event): number | null {
    const now = this.nowMs();
    if (now === null) return null;
    return now + (e.timeStamp - performance.now());
  }

  /** Current audio time in milliseconds, or null before unlock. */
  nowMs(): number | null {
    return this.ctx ? this.ctx.currentTime * 1000 : null;
  }

  /** Create/resume the AudioContext. Must be called from a user gesture. */
  async unlock(): Promise<void> {
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state !== 'running') {
      await this.ctx.resume();
    }
  }

  /**
   * Play a short beep through an oscillator + gain envelope. Proves the
   * Web Audio path end to end without needing any audio assets.
   */
  playBeep(frequency = 880, durationS = 0.12): void {
    if (!this.ctx || this.ctx.state !== 'running') return;

    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'square';
    osc.frequency.value = frequency;

    gain.gain.setValueAtTime(0.15, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + durationS);

    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + durationS);
  }
}
