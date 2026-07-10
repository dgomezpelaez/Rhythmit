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
