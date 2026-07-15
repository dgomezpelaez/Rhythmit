/**
 * Turn detected onsets into playable charts. One analysis pass feeds all
 * three difficulties: onsets are merged into events, then each difficulty
 * keeps a different slice by strength and enforces its own spacing rules.
 * Quality bar is "pretty good, not hand-crafted".
 */

import { parseChart, type Chart, type Direction, type Note } from '../chart';
import type { BpmEstimate } from './bpm';
import type { Band, BandOnsets } from './onsets';

export const AUTO_DIFFICULTIES = ['easy', 'normal', 'hard'] as const;
export type AutoDifficulty = (typeof AUTO_DIFFICULTIES)[number];

interface DifficultyParams {
  /** Keep this fraction of events, strongest first. */
  keepFraction: number;
  /** Minimum gap between events as a fraction of the beat period… */
  minGapBeats: number;
  /** …but never below this floor (guards against fast/misdetected BPM). */
  minGapFloorMs: number;
  maxSimultaneous: 1 | 2;
  /** Event strength needed before a second simultaneous note is allowed. */
  chordMinStrength: number;
  /** Safety cap on sustained density (sliding-window notes per second). */
  maxNps: number;
}

const PARAMS: Record<AutoDifficulty, DifficultyParams> = {
  easy: { keepFraction: 0.3, minGapBeats: 1, minGapFloorMs: 300, maxSimultaneous: 1, chordMinStrength: Infinity, maxNps: 1.5 },
  normal: { keepFraction: 0.45, minGapBeats: 0.5, minGapFloorMs: 180, maxSimultaneous: 2, chordMinStrength: 0.95, maxNps: 3 },
  hard: { keepFraction: 0.6, minGapBeats: 0.25, minGapFloorMs: 110, maxSimultaneous: 2, chordMinStrength: 0.8, maxNps: 5 },
};

/** Sliding window used to enforce {@link DifficultyParams.maxNps}. */
const NPS_WINDOW_MS = 2000;

/** Onsets from different bands within this window are one musical event. */
const EVENT_MERGE_MS = 30;
/** Ignore events weaker than this even on hard. */
const MIN_STRENGTH = 0.05;
/** Snap to the 16th grid only when the correction is this small. */
const MAX_SNAP_MS = 25;
/** Player runway: no notes before this (gameplay lead-in is only 0.2 s). */
const FIRST_NOTE_MS = 800;
const LAST_NOTE_MARGIN_MS = 200;

interface AutoEvent {
  timeMs: number;
  /** Strongest constituent onset — the event's overall strength. */
  strength: number;
  /** Per-band strengths, strongest first. */
  bands: { band: Band; strength: number }[];
}

export function generateCharts(
  onsets: readonly BandOnsets[],
  bpm: BpmEstimate,
  durationMs: number,
  opts: { title: string; audioName: string },
): Record<AutoDifficulty, Chart> {
  const events = mergeIntoEvents(onsets);
  const result = {} as Record<AutoDifficulty, Chart>;
  for (const difficulty of AUTO_DIFFICULTIES) {
    const notes = buildNotes(events, PARAMS[difficulty], bpm, durationMs);
    const chart: Chart = {
      version: 1,
      song: {
        title: opts.title,
        artist: 'auto-chart',
        audio: opts.audioName,
        bpm: bpm.bpm,
        offsetMs: bpm.offsetMs,
      },
      difficulty,
      notes,
    };
    // parseChart is the modding contract; a generated chart must honor it
    // too (it also throws the friendly "chart has no notes" for silence).
    result[difficulty] = parseChart(chart);
  }
  return result;
}

function mergeIntoEvents(onsets: readonly BandOnsets[]): AutoEvent[] {
  const flat: { timeMs: number; band: Band; strength: number }[] = [];
  for (const { band, timesMs, strengths } of onsets) {
    for (let i = 0; i < timesMs.length; i++) {
      flat.push({ timeMs: timesMs[i]!, band, strength: strengths[i]! });
    }
  }
  flat.sort((a, b) => a.timeMs - b.timeMs);

  const events: AutoEvent[] = [];
  for (const onset of flat) {
    const last = events[events.length - 1];
    if (last && onset.timeMs - last.timeMs <= EVENT_MERGE_MS) {
      const existing = last.bands.find((b) => b.band === onset.band);
      if (existing) {
        existing.strength = Math.max(existing.strength, onset.strength);
      } else {
        last.bands.push({ band: onset.band, strength: onset.strength });
      }
      last.strength = Math.max(last.strength, onset.strength);
    } else {
      events.push({
        timeMs: onset.timeMs,
        strength: onset.strength,
        bands: [{ band: onset.band, strength: onset.strength }],
      });
    }
  }
  for (const e of events) e.bands.sort((a, b) => b.strength - a.strength);
  return events;
}

function buildNotes(
  events: readonly AutoEvent[],
  params: DifficultyParams,
  bpm: BpmEstimate,
  durationMs: number,
): Note[] {
  // Strength cut: keep the strongest `keepFraction` of events.
  const sorted = [...events].map((e) => e.strength).sort((a, b) => b - a);
  const cutIndex = Math.floor(sorted.length * params.keepFraction);
  const cutoff = Math.max(MIN_STRENGTH, sorted[cutIndex] ?? Infinity);
  let kept = events.filter((e) => e.strength >= cutoff);

  // Spacing: on collision keep the stronger event. The gap is tempo-relative
  // so a fast song doesn't turn into a stream just because its beats are close.
  const beatMs = 60000 / bpm.bpm;
  const minGapMs = Math.max(params.minGapFloorMs, params.minGapBeats * beatMs);
  const spaced: AutoEvent[] = [];
  for (const event of kept) {
    const last = spaced[spaced.length - 1];
    if (last && event.timeMs - last.timeMs < minGapMs) {
      if (event.strength > last.strength) spaced[spaced.length - 1] = event;
      continue;
    }
    spaced.push(event);
  }
  kept = spaced;

  const sixteenthMs = beatMs / 4;
  // Timestamps of recently emitted notes, for the sliding-window density cap.
  const recentMs: number[] = [];

  const notes: Note[] = [];
  for (const event of kept) {
    // Gentle grid snap — only when the estimate agrees with the onset.
    let timeMs = event.timeMs;
    const gridMs =
      bpm.offsetMs + Math.round((timeMs - bpm.offsetMs) / sixteenthMs) * sixteenthMs;
    if (Math.abs(gridMs - timeMs) <= MAX_SNAP_MS && gridMs >= 0) timeMs = gridMs;
    timeMs = Math.round(timeMs);

    if (timeMs < FIRST_NOTE_MS || timeMs > durationMs - LAST_NOTE_MARGIN_MS) continue;

    while (recentMs.length > 0 && timeMs - recentMs[0]! > NPS_WINDOW_MS) {
      recentMs.shift();
    }

    const maxNotes =
      params.maxSimultaneous === 2 && event.strength >= params.chordMinStrength ? 2 : 1;
    const usedDirs = new Set<Direction>();

    for (const { band } of event.bands) {
      if (usedDirs.size >= maxNotes) break;
      // Density cap: skip once the trailing window is already at maxNps.
      if (recentMs.length >= params.maxNps * (NPS_WINDOW_MS / 1000)) break;
      const dir = assignDir(band, timeMs, bpm.offsetMs, beatMs, usedDirs);
      if (!dir) continue;
      usedDirs.add(dir);
      recentMs.push(timeMs);
      notes.push({ timeMs, dir, type: 'tap' });
    }
  }
  return notes;
}

/**
 * Band → direction, kept strictly so charts read like the music: bass is
 * always down, treble always up, and mid picks left/right from the note's
 * eighth-note position on the beat grid. Side = beat parity + within-beat
 * eighth parity, so on-beat hits alternate L R L R across the bar and eighth
 * runs use both hands — but the choice is a pure function of *where in the
 * bar* the note falls, so a riff that repeats every measure yields the same
 * hand pattern every time. Same-direction runs are fine (two kicks = two
 * down arrows); only a same-event duplicate returns null (drop the note).
 */
function assignDir(
  band: Band,
  timeMs: number,
  offsetMs: number,
  beatMs: number,
  usedDirs: ReadonlySet<Direction>,
): Direction | null {
  if (band === 'bass') return usedDirs.has('down') ? null : 'down';
  if (band === 'treble') return usedDirs.has('up') ? null : 'up';

  const eighthIndex = Math.round((timeMs - offsetMs) / (beatMs / 2));
  const beatIndex = Math.floor(eighthIndex / 2);
  const parity = (((beatIndex + eighthIndex) % 2) + 2) % 2;
  const side: Direction = parity === 0 ? 'left' : 'right';
  if (!usedDirs.has(side)) return side;
  const other: Direction = side === 'left' ? 'right' : 'left';
  return usedDirs.has(other) ? null : other;
}
