/**
 * Offline onset detection: STFT → per-band spectral flux → adaptive-threshold
 * peak picking. Pure functions over Float32Arrays so the whole chain is
 * worker-friendly and testable against the synthesized test track.
 */

import { fft } from './fft';

export const WINDOW_SIZE = 2048;
export const HOP_SIZE = 512;

/**
 * Added to every raw flux-frame time: frame-start timestamping plus log
 * compression makes the flux peak land a couple of hops before the audible
 * attack. Calibrated against the synthesized 128 BPM test track via the
 * signedMeanMs reported by __autochartSelfTest (target ≈ 0).
 */
export const ONSET_TIME_CORRECTION_MS = 20;

export type Band = 'bass' | 'mid' | 'treble';

/** Frequency ranges per band; the 3000–4500 Hz gap keeps snare noise out of treble. */
const BAND_HZ: Record<Band, readonly [number, number]> = {
  bass: [20, 160],
  mid: [160, 3000],
  treble: [4500, 16000],
};

export const BANDS: readonly Band[] = ['bass', 'mid', 'treble'];

export interface FluxResult {
  /** Milliseconds between consecutive flux frames (hop / sampleRate). */
  hopMs: number;
  /** Half-wave-rectified spectral flux per band, one value per frame. */
  bandFlux: Record<Band, Float32Array>;
  /** Broadband flux envelope (20 Hz – 16 kHz) used for BPM estimation. */
  totalFlux: Float32Array;
}

export function computeBandFlux(
  samples: Float32Array,
  sampleRate: number,
  onProgress?: (frac: number) => void,
): FluxResult {
  const hopMs = (HOP_SIZE / sampleRate) * 1000;
  const frameCount = Math.max(
    0,
    Math.floor((samples.length - WINDOW_SIZE) / HOP_SIZE) + 1,
  );

  const hann = new Float32Array(WINDOW_SIZE);
  for (let i = 0; i < WINDOW_SIZE; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (WINDOW_SIZE - 1)));
  }

  const binHz = sampleRate / WINDOW_SIZE;
  const binRange = (lo: number, hi: number): [number, number] => [
    Math.max(1, Math.floor(lo / binHz)),
    Math.min(WINDOW_SIZE / 2, Math.ceil(hi / binHz)),
  ];
  const bandBins: Record<Band, [number, number]> = {
    bass: binRange(...BAND_HZ.bass),
    mid: binRange(...BAND_HZ.mid),
    treble: binRange(...BAND_HZ.treble),
  };
  const [totalLo, totalHi] = binRange(20, 16000);

  const re = new Float32Array(WINDOW_SIZE);
  const im = new Float32Array(WINDOW_SIZE);
  // Streaming: only the previous frame's log-magnitudes are kept.
  const prevMag = new Float32Array(WINDOW_SIZE / 2 + 1);
  const curMag = new Float32Array(WINDOW_SIZE / 2 + 1);

  const bandFlux: Record<Band, Float32Array> = {
    bass: new Float32Array(frameCount),
    mid: new Float32Array(frameCount),
    treble: new Float32Array(frameCount),
  };
  const totalFlux = new Float32Array(frameCount);

  for (let frame = 0; frame < frameCount; frame++) {
    const start = frame * HOP_SIZE;
    for (let i = 0; i < WINDOW_SIZE; i++) {
      re[i] = samples[start + i]! * hann[i]!;
      im[i] = 0;
    }
    fft(re, im);
    for (let b = 0; b <= WINDOW_SIZE / 2; b++) {
      // log1p tames loudness dependence so quiet mixes still chart.
      curMag[b] = Math.log1p(Math.hypot(re[b]!, im[b]!));
    }

    if (frame > 0) {
      for (const band of BANDS) {
        const [lo, hi] = bandBins[band];
        let sum = 0;
        for (let b = lo; b < hi; b++) {
          const d = curMag[b]! - prevMag[b]!;
          if (d > 0) sum += d;
        }
        bandFlux[band][frame] = sum;
      }
      let total = 0;
      for (let b = totalLo; b < totalHi; b++) {
        const d = curMag[b]! - prevMag[b]!;
        if (d > 0) total += d;
      }
      totalFlux[frame] = total;
    }

    prevMag.set(curMag);
    if (onProgress && frame % 256 === 0) onProgress(frame / frameCount);
  }

  return { hopMs, bandFlux, totalFlux };
}

export interface BandOnsets {
  band: Band;
  /** Onset times in ms into the audio, ascending. */
  timesMs: Float32Array;
  /** Matching per-onset strengths, normalized 0..1 within the band. */
  strengths: Float32Array;
}

const THRESHOLD_WINDOW_S = 0.5;
const THRESHOLD_MULTIPLIER = 1.3;
const PEAK_NEIGHBORHOOD = 3;
const MIN_ONSET_GAP_MS = 50;

export function pickOnsets(
  flux: Float32Array,
  hopMs: number,
  band: Band,
): BandOnsets {
  const n = flux.length;
  const w = Math.max(1, Math.round((THRESHOLD_WINDOW_S * 1000) / hopMs));

  let mean = 0;
  for (let i = 0; i < n; i++) mean += flux[i]!;
  mean = n > 0 ? mean / n : 0;
  const meanTerm = 0.05 * mean;

  // Adaptive threshold: windowed median × multiplier + a small mean floor.
  const threshold = new Float32Array(n);
  const scratch: number[] = [];
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - w);
    const hi = Math.min(n, i + w + 1);
    scratch.length = 0;
    for (let j = lo; j < hi; j++) scratch.push(flux[j]!);
    scratch.sort((a, b) => a - b);
    const median = scratch[scratch.length >> 1]!;
    threshold[i] = median * THRESHOLD_MULTIPLIER + meanTerm;
  }

  // Local maxima above threshold, with a minimum inter-onset gap.
  const times: number[] = [];
  const excesses: number[] = [];
  const minGapFrames = Math.round(MIN_ONSET_GAP_MS / hopMs);
  let lastFrame = -Infinity;
  for (let i = 1; i < n - 1; i++) {
    if (flux[i]! <= threshold[i]!) continue;
    let isPeak = true;
    for (let j = Math.max(0, i - PEAK_NEIGHBORHOOD); j <= Math.min(n - 1, i + PEAK_NEIGHBORHOOD); j++) {
      if (flux[j]! > flux[i]!) {
        isPeak = false;
        break;
      }
    }
    if (!isPeak) continue;
    if (i - lastFrame < minGapFrames) {
      // Keep the stronger of the two colliding peaks.
      const prevExcess = excesses[excesses.length - 1]!;
      const excess = flux[i]! - threshold[i]!;
      if (excess > prevExcess) {
        times[times.length - 1] = i;
        excesses[excesses.length - 1] = excess;
        lastFrame = i;
      }
      continue;
    }
    times.push(i);
    excesses.push(flux[i]! - threshold[i]!);
    lastFrame = i;
  }

  // Normalize strengths by the band's 95th-percentile excess.
  const sorted = [...excesses].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 1;
  const scale = p95 > 0 ? 1 / p95 : 1;

  const timesMs = new Float32Array(times.length);
  const strengths = new Float32Array(times.length);
  for (let i = 0; i < times.length; i++) {
    timesMs[i] = Math.max(0, times[i]! * hopMs + ONSET_TIME_CORRECTION_MS);
    strengths[i] = Math.min(1, excesses[i]! * scale);
  }
  return { band, timesMs, strengths };
}
