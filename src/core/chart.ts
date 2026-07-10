/**
 * Chart format — the modding contract (design doc §3.1). Notes are absolute
 * milliseconds into the audio, not beat fractions. Validation errors are
 * human-readable because modder experience is user experience.
 */

export type Direction = 'left' | 'right' | 'up' | 'down';
export type NoteType = 'tap' | 'hold';

export interface Note {
  timeMs: number;
  dir: Direction;
  type: NoteType;
  durationMs?: number;
  /** Optional cosmetic food override (e.g. "chili"). */
  food?: string;
}

export interface SongMeta {
  title: string;
  artist: string;
  audio: string;
  bpm: number;
  offsetMs: number;
}

export interface Chart {
  version: number;
  song: SongMeta;
  difficulty: string;
  notes: Note[];
}

const DIRECTIONS: readonly Direction[] = ['left', 'right', 'up', 'down'];
const NOTE_TYPES: readonly NoteType[] = ['tap', 'hold'];

class ChartError extends Error {}

function fail(path: string, message: string): never {
  throw new ChartError(`${path}: ${message}`);
}

function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, 'expected an object');
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(path, 'expected a string');
  return value;
}

function requireFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(path, 'expected a number');
  }
  return value;
}

/** Parse and validate a chart. Throws Error with a readable message. */
export function parseChart(json: unknown): Chart {
  const root = requireObject(json, 'chart');

  const version = requireFiniteNumber(root['version'], 'version');
  if (version !== 1) fail('version', `unsupported version ${version} (expected 1)`);

  const songRaw = requireObject(root['song'], 'song');
  const bpm = requireFiniteNumber(songRaw['bpm'], 'song.bpm');
  if (bpm <= 0) fail('song.bpm', 'must be positive');
  const song: SongMeta = {
    title: requireString(songRaw['title'], 'song.title'),
    artist: requireString(songRaw['artist'], 'song.artist'),
    audio: requireString(songRaw['audio'], 'song.audio'),
    bpm,
    offsetMs:
      songRaw['offsetMs'] === undefined
        ? 0
        : requireFiniteNumber(songRaw['offsetMs'], 'song.offsetMs'),
  };

  const difficulty =
    root['difficulty'] === undefined
      ? 'normal'
      : requireString(root['difficulty'], 'difficulty');

  const notesRaw = root['notes'];
  if (!Array.isArray(notesRaw)) fail('notes', 'expected an array');
  if (notesRaw.length === 0) fail('notes', 'chart has no notes');

  const notes = notesRaw.map((raw, i) => {
    const path = `notes[${i}]`;
    const n = requireObject(raw, path);

    const timeMs = requireFiniteNumber(n['timeMs'], `${path}.timeMs`);
    if (timeMs < 0) fail(`${path}.timeMs`, 'must be >= 0');

    const dir = requireString(n['dir'], `${path}.dir`) as Direction;
    if (!DIRECTIONS.includes(dir)) {
      fail(`${path}.dir`, `"${dir}" is not one of ${DIRECTIONS.join('/')}`);
    }

    const type = (
      n['type'] === undefined ? 'tap' : requireString(n['type'], `${path}.type`)
    ) as NoteType;
    if (!NOTE_TYPES.includes(type)) {
      fail(`${path}.type`, `"${type}" is not one of ${NOTE_TYPES.join('/')}`);
    }

    const note: Note = { timeMs, dir, type };
    if (type === 'hold') {
      note.durationMs = requireFiniteNumber(
        n['durationMs'],
        `${path}.durationMs`,
      );
      if (note.durationMs <= 0) fail(`${path}.durationMs`, 'must be positive');
    }
    if (n['food'] !== undefined) {
      note.food = requireString(n['food'], `${path}.food`);
    }
    return note;
  });

  notes.sort((a, b) => a.timeMs - b.timeMs);

  return { version, song, difficulty, notes };
}
