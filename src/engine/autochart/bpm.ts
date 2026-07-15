/**
 * Tempo and beat-phase estimation from the broadband flux envelope.
 * Autocorrelation over musically plausible lags, with octave folding that
 * prefers the 100–160 BPM sweet spot. BPM/offset only drive cosmetics
 * (downbeat zoom, beat markers) — errors here are non-fatal.
 */

export interface BpmEstimate {
  bpm: number;
  offsetMs: number;
}

const MIN_BPM = 60;
const MAX_BPM = 200;
const SWEET_LO = 100;
const SWEET_HI = 160;

export function estimateBpm(totalFlux: Float32Array, hopMs: number): BpmEstimate {
  const n = totalFlux.length;
  const minLag = Math.max(1, Math.round(60000 / MAX_BPM / hopMs));
  const maxLag = Math.min(n - 1, Math.round(60000 / MIN_BPM / hopMs));
  if (maxLag <= minLag) return { bpm: 120, offsetMs: 0 };

  const score = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let t = 0; t + lag < n; t++) s += totalFlux[t]! * totalFlux[t + lag]!;
    // Normalize by overlap length so long lags aren't penalized.
    score[lag] = s / (n - lag);
  }

  let rawBest = minLag;
  for (let lag = minLag + 1; lag <= maxLag; lag++) {
    if (score[lag]! > score[rawBest]!) rawBest = lag;
  }

  // Octave disambiguation. A backbeat (snare on 2/4) makes the two-beat lag
  // outscore the true beat, so judge each octave candidate by its harmonic
  // score — itself plus half its double — with a bonus for the 100–160 BPM
  // sweet spot. True lags are rarely integer frame counts, so snap each
  // candidate to the strongest lag in a small neighborhood first.
  const bpmOf = (lag: number) => 60000 / (lag * hopMs);
  const peakNear = (center: number): number => {
    let best = -1;
    for (
      let lag = Math.max(minLag, center - 2);
      lag <= Math.min(maxLag, center + 2);
      lag++
    ) {
      if (best === -1 || score[lag]! > score[best]!) best = lag;
    }
    return best;
  };
  const harmonic = (lag: number) => {
    const double = peakNear(lag * 2);
    return score[lag]! + (double === -1 ? 0 : 0.5 * score[double]!);
  };
  const inSweet = (lag: number) => bpmOf(lag) >= SWEET_LO && bpmOf(lag) <= SWEET_HI;

  let bestLag = rawBest;
  let bestScore = -1;
  for (const center of [Math.round(rawBest / 2), rawBest, rawBest * 2]) {
    const candidate = peakNear(center);
    if (candidate === -1) continue;
    const s = harmonic(candidate) * (inSweet(candidate) ? 1.15 : 1);
    if (s > bestScore) {
      bestScore = s;
      bestLag = candidate;
    }
  }

  // Parabolic interpolation around the peak for sub-frame precision.
  let lag = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const a = score[bestLag - 1]!;
    const b = score[bestLag]!;
    const c = score[bestLag + 1]!;
    const denom = a - 2 * b + c;
    if (denom !== 0) {
      const shift = (0.5 * (a - c)) / denom;
      if (Math.abs(shift) < 1) lag = bestLag + shift;
    }
  }

  const bpm = Math.min(MAX_BPM, Math.max(MIN_BPM, 60000 / (lag * hopMs)));
  const periodMs = 60000 / bpm;

  // Beat phase: scan candidate offsets, keep the one whose grid collects the
  // most flux. Aligns beat markers to the strongest recurring transient.
  let bestOffset = 0;
  let bestPhaseScore = -1;
  for (let offset = 0; offset < periodMs; offset += 10) {
    let s = 0;
    for (let beatMs = offset; beatMs < n * hopMs; beatMs += periodMs) {
      const frame = Math.round(beatMs / hopMs);
      if (frame < n) s += totalFlux[frame]!;
    }
    if (s > bestPhaseScore) {
      bestPhaseScore = s;
      bestOffset = offset;
    }
  }

  return { bpm: Math.round(bpm * 10) / 10, offsetMs: Math.round(bestOffset) };
}
