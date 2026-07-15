import type { Direction, Note } from './chart';

/** Timing windows in ms (design doc Phase 2; tune later). */
export const WINDOWS = { perfect: 45, good: 90, okay: 135 } as const;

export type Judgment = 'perfect' | 'good' | 'okay' | 'miss';
export type NoteState = 'pending' | 'hit' | 'missed';

export interface HitResult {
  noteIndex: number;
  judgment: Exclude<Judgment, 'miss'>;
  /** Signed: positive = late, negative = early. */
  errorMs: number;
}

export function judgmentFor(absErrorMs: number): Exclude<Judgment, 'miss'> | null {
  if (absErrorMs <= WINDOWS.perfect) return 'perfect';
  if (absErrorMs <= WINDOWS.good) return 'good';
  if (absErrorMs <= WINDOWS.okay) return 'okay';
  return null;
}

/**
 * Tracks per-note judgment state for one play-through of a chart.
 * All times are song-time ms, already corrected for calibration offset —
 * this class knows nothing about clocks or input devices.
 */
export class HitJudge {
  private readonly states: NoteState[];
  /** Sweep cursor: all notes before this index are judged. */
  private sweepFrom = 0;

  constructor(private readonly notes: readonly Note[]) {
    this.states = notes.map(() => 'pending');
  }

  stateOf(index: number): NoteState {
    return this.states[index] ?? 'pending';
  }

  get totalCount(): number {
    return this.notes.length;
  }

  get judgedCount(): number {
    return this.states.filter((s) => s !== 'pending').length;
  }

  get allJudged(): boolean {
    return this.states.every((s) => s !== 'pending');
  }

  /**
   * Attempt to hit with a direction key at a song time. Consumes the nearest
   * pending note of that direction within the okay window. Returns null for
   * a stray tap (no note in range) — no penalty, nothing consumed.
   */
  tryHit(dir: Direction, songTimeMs: number): HitResult | null {
    let best: HitResult | null = null;
    for (let i = 0; i < this.notes.length; i++) {
      const note = this.notes[i]!;
      if (this.states[i] !== 'pending' || note.dir !== dir) continue;
      const errorMs = songTimeMs - note.timeMs;
      if (errorMs < -WINDOWS.okay) break; // notes sorted; rest are too far out
      const judgment = judgmentFor(Math.abs(errorMs));
      if (judgment === null) continue;
      if (best === null || Math.abs(errorMs) < Math.abs(best.errorMs)) {
        best = { noteIndex: i, judgment, errorMs };
      }
    }
    if (best) this.states[best.noteIndex] = 'hit';
    return best;
  }

  /** Mark notes whose window has passed as missed; returns their indices. */
  sweepMisses(songTimeMs: number): number[] {
    const missed: number[] = [];
    for (let i = this.sweepFrom; i < this.notes.length; i++) {
      const note = this.notes[i]!;
      if (note.timeMs > songTimeMs - WINDOWS.okay) break;
      if (this.states[i] === 'pending') {
        this.states[i] = 'missed';
        missed.push(i);
      }
    }
    while (
      this.sweepFrom < this.notes.length &&
      this.states[this.sweepFrom] !== 'pending'
    ) {
      this.sweepFrom++;
    }
    return missed;
  }

  /** Index of the next pending note at/after songTimeMs (for debug UI). */
  nextPendingIndex(songTimeMs: number): number | null {
    for (let i = this.sweepFrom; i < this.notes.length; i++) {
      if (this.states[i] === 'pending' && this.notes[i]!.timeMs >= songTimeMs) {
        return i;
      }
    }
    return null;
  }
}
