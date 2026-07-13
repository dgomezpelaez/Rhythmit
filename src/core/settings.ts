/** Persistent player settings (localStorage). */

const CALIBRATION_KEY = 'mf.calibrationOffsetMs';

export function loadCalibrationOffsetMs(): number {
  const raw = localStorage.getItem(CALIBRATION_KEY);
  const value = raw === null ? NaN : Number(raw);
  return Number.isFinite(value) ? value : 0;
}

export function saveCalibrationOffsetMs(offsetMs: number): void {
  localStorage.setItem(CALIBRATION_KEY, String(Math.round(offsetMs)));
}

const SELECTED_SONG_KEY = 'mf.selectedSong';
const SELECTED_CHARACTER_KEY = 'mf.selectedCharacter';

export function loadSelectedSongId(): string | null {
  return localStorage.getItem(SELECTED_SONG_KEY);
}

export function saveSelectedSongId(id: string): void {
  localStorage.setItem(SELECTED_SONG_KEY, id);
}

export function loadSelectedCharacterId(): string | null {
  return localStorage.getItem(SELECTED_CHARACTER_KEY);
}

export function saveSelectedCharacterId(id: string): void {
  localStorage.setItem(SELECTED_CHARACTER_KEY, id);
}
