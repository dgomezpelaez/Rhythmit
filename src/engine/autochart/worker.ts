/**
 * Auto-chart worker: mono PCM in → three validated charts out. The whole
 * handler is wrapped so broken input becomes an 'error' reply instead of a
 * stuck progress bar. Cancellation is terminate-and-respawn (a busy worker
 * never sees messages), so no cancel handling exists here.
 */

import { ValidationError } from '../validate';
import { estimateBpm } from './bpm';
import { generateCharts } from './generate';
import type { AnalyzeRequest, WorkerReply } from './messages';
import {
  BANDS,
  computeBandFlux,
  ONSET_TIME_CORRECTION_MS,
  pickOnsets,
} from './onsets';

function reply(msg: WorkerReply): void {
  postMessage(msg);
}

self.onmessage = (e: MessageEvent<AnalyzeRequest>) => {
  const req = e.data;
  if (req.type !== 'analyze') return;
  const { jobId } = req;
  try {
    // Phase 1 (0–80%): STFT + spectral flux, the bulk of the work.
    const flux = computeBandFlux(req.samples, req.sampleRate, (frac) => {
      reply({ type: 'progress', jobId, phase: 'analyzing', percent: frac * 80 });
    });

    // Phase 2 (80–95%): peak picking + tempo.
    reply({ type: 'progress', jobId, phase: 'detecting', percent: 80 });
    const onsets = BANDS.map((band) =>
      pickOnsets(flux.bandFlux[band], flux.hopMs, band),
    );
    const bpm = estimateBpm(flux.totalFlux, flux.hopMs);
    // The phase scan ran on raw frame times; shift it by the same correction
    // applied to onset times so the beat grid and the notes agree.
    const periodMs = 60000 / bpm.bpm;
    bpm.offsetMs = Math.round(
      (((bpm.offsetMs + ONSET_TIME_CORRECTION_MS) % periodMs) + periodMs) % periodMs,
    );

    // Phase 3 (95–100%): notes + validation.
    reply({ type: 'progress', jobId, phase: 'building', percent: 95 });
    const durationMs = (req.samples.length / req.sampleRate) * 1000;
    const charts = generateCharts(onsets, bpm, durationMs, {
      title: req.title,
      audioName: req.audioName,
    });

    reply({ type: 'done', jobId, bpm: bpm.bpm, charts });
  } catch (err) {
    const message =
      err instanceof ValidationError
        ? `no beats detected in "${req.audioName}" — try a track with clearer drums`
        : err instanceof Error
          ? err.message
          : String(err);
    reply({ type: 'error', jobId, message });
  }
};
