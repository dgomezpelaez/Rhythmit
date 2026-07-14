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
  minGapMs: number;
  sameDirGapMs: number;
  maxSimultaneous: 1 | 2;
  /** Event strength needed before a second simultaneous note is allowed. */
  chordMinStrength: number;
}

const PARAMS: Record<AutoDifficulty, DifficultyParams> = {
  easy: { keepFraction: 0.35, minGapMs: 250, sameDirGapMs: 500, maxSimultaneous: 1, chordMinStrength: Infinity },
  normal: { keepFraction: 0.6, minGapMs: 150, sameDirGapMs: 300, maxSimultaneous: 2, chordMinStrength: 0.8 },
  hard: { keepFraction: 0.85, minGapMs: 90, sameDirGapMs: 180, maxSimultaneous: 2, chordMinStrength: 0.6 },
};

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

  // Spacing: on collision keep the stronger event.
  const spaced: AutoEvent[] = [];
  for (const event of kept) {
    const last = spaced[spaced.length - 1];
    if (last && event.timeMs - last.timeMs < params.minGapMs) {
      if (event.strength > last.strength) spaced[spaced.length - 1] = event;
      continue;
    }
    spaced.push(event);
  }
  kept = spaced;

  const sixteenthMs = 60000 / bpm.bpm / 4;
  const lastTimeByDir: Record<Direction, number> = {
    left: -Infinity,
    right: -Infinity,
    up: -Infinity,
    down: -Infinity,
  };
  let midSide: Direction = 'left';

  const notes: Note[] = [];
  for (const event of kept) {
    // Gentle grid snap — only when the estimate agrees with the onset.
    let timeMs = event.timeMs;
    const gridMs =
      bpm.offsetMs + Math.round((timeMs - bpm.offsetMs) / sixteenthMs) * sixteenthMs;
    if (Math.abs(gridMs - timeMs) <= MAX_SNAP_MS && gridMs >= 0) timeMs = gridMs;
    timeMs = Math.round(timeMs);

    if (timeMs < FIRST_NOTE_MS || timeMs > durationMs - LAST_NOTE_MARGIN_MS) continue;

    const maxNotes =
      params.maxSimultaneous === 2 && event.strength >= params.chordMinStrength ? 2 : 1;
    const usedDirs = new Set<Direction>();

    for (const { band } of event.bands) {
      if (usedDirs.size >= maxNotes) break;
      const dir = assignDir(band, usedDirs, lastTimeByDir, timeMs, params.sameDirGapMs, midSide);
      if (!dir) continue;
      if (band === 'mid') midSide = dir === 'left' ? 'right' : 'left';
      usedDirs.add(dir);
      lastTimeByDir[dir] = timeMs;
      notes.push({ timeMs, dir, type: 'tap' });
    }
  }
  return notes;
}

/**
 * Band → direction with jack avoidance: bass→down, treble→up, mid→L/R
 * alternating. A direction hit too recently is swapped — mid flips sides,
 * bass/treble fall back to the least-recently-used direction. Returns null
 * when every direction would be a jack (drop the note).
 */
function assignDir(
  band: Band,
  usedDirs: ReadonlySet<Direction>,
  lastTimeByDir: Readonly<Record<Direction, number>>,
  timeMs: number,
  sameDirGapMs: number,
  midSide: Direction,
): Direction | null {
  const ok = (dir: Direction) =>
    !usedDirs.has(dir) && timeMs - lastTimeByDir[dir] >= sameDirGapMs;

  const preferred: Direction[] =
    band === 'bass'
      ? ['down']
      : band === 'treble'
        ? ['up']
        : [midSide, midSide === 'left' ? 'right' : 'left'];
  for (const dir of preferred) if (ok(dir)) return dir;

  // Fallback: least-recently-used direction that doesn't jack.
  const byLru = (['left', 'right', 'up', 'down'] as const)
    .filter(ok)
    .sort((a, b) => lastTimeByDir[a] - lastTimeByDir[b]);
  return byLru[0] ?? null;
}
