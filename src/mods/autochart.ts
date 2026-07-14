/**
 * Auto-charting orchestrator: dropped audio file → decoded PCM → worker
 * analysis → three registered songs, cached in IndexedDB by content hash.
 *
 * decodeAudioData only exists on the main thread, so decode happens here;
 * only the mono PCM crosses into the worker (as a transferable). Cancel is
 * terminate-and-respawn: a DSP-busy worker never services its message
 * queue, so a cancel message would arrive too late to matter.
 */

import { AUTO_DIFFICULTIES, type AutoDifficulty } from '../core/autochart/generate';
import type { AnalyzeRequest, WorkerReply } from '../core/autochart/messages';
import { parseChart, type Chart } from '../core/chart';
import {
  idbDeleteAutochart,
  idbGetAutochart,
  idbPutAutochart,
  type StoredAutochart,
} from './db';
import { sha256Hex } from './hash';
import type { ContentRegistry } from './registry';

export const AUDIO_FILE_RE = /\.(mp3|ogg|wav|m4a|flac)$/i;

const MAX_DURATION_MIN = 15;

export interface AutochartUi {
  setStatus(text: string, isError?: boolean): void;
  showErrors(errors: readonly string[]): void;
  /** null hides the bar; percent is 0–100. */
  setProgress(state: { label: string; percent: number } | null): void;
  /** Re-render the installed list after rows change. */
  renderRows(): void;
  /** Song list changed — refresh select screens. */
  onContentChanged(): void;
}

export interface AutochartRow {
  hash: string;
  name: string;
  summary: string;
}

export interface AutochartManager {
  importAudioFile(file: File): Promise<void>;
  remove(hash: string): Promise<void>;
  restore(recs: readonly StoredAutochart[]): string[];
  readonly rows: ReadonlyArray<AutochartRow>;
}

export function createAutochartManager(opts: {
  registry: ContentRegistry;
  audio: BaseAudioContext;
  persistent: boolean;
  ui: AutochartUi;
}): AutochartManager {
  const { registry, ui } = opts;
  const rows = new Map<string, AutochartRow>();

  let worker: Worker | null = null;
  let currentJobId = 0;

  const spawnWorker = (): Worker => {
    const w = new Worker(new URL('../core/autochart/worker.ts', import.meta.url), {
      type: 'module',
    });
    w.onmessage = (e: MessageEvent<WorkerReply>) => handleReply(e.data);
    w.onerror = (e) => {
      ui.setProgress(null);
      ui.setStatus(`auto-chart failed: ${e.message || 'worker error'}`, true);
    };
    return w;
  };

  interface PendingJob {
    fileName: string;
    audio: Blob;
    resolve: () => void;
  }
  const pending = new Map<number, PendingJob>();

  const summarize = (charts: Record<AutoDifficulty, Chart>): string =>
    `auto-chart · ${charts.easy.notes.length}/${charts.normal.notes.length}/${charts.hard.notes.length} notes`;

  const register = (rec: {
    hash: string;
    fileName: string;
    audio: Blob;
    charts: Record<AutoDifficulty, Chart>;
  }): void => {
    registry.registerAutochart(rec);
    rows.set(rec.hash, {
      hash: rec.hash,
      name: rec.fileName,
      summary: summarize(rec.charts),
    });
    ui.renderRows();
    ui.onContentChanged();
  };

  const handleReply = (msg: WorkerReply): void => {
    if (msg.jobId !== currentJobId) return; // stale job, worker was replaced
    const job = pending.get(msg.jobId);
    if (!job) return;

    if (msg.type === 'progress') {
      const label = {
        analyzing: 'analyzing audio',
        detecting: 'finding beats',
        building: 'building charts',
      }[msg.phase];
      ui.setProgress({ label: `${label}… ${Math.round(msg.percent)}%`, percent: msg.percent });
      return;
    }

    pending.delete(msg.jobId);
    ui.setProgress(null);

    if (msg.type === 'error') {
      hashOfJob.delete(msg.jobId);
      ui.showErrors([msg.message]);
      ui.setStatus(`could not auto-chart "${job.fileName}"`, true);
      job.resolve();
      return;
    }

    const hash = hashOfJob.get(msg.jobId) ?? `nohash:${msg.jobId}`;
    hashOfJob.delete(msg.jobId);
    const rec = {
      hash,
      fileName: job.fileName,
      audio: job.audio,
      charts: msg.charts,
    };
    register(rec);
    ui.setStatus(
      `auto-charted "${job.fileName}" — ${msg.bpm} BPM, 3 difficulties`,
    );
    job.resolve();

    if (opts.persistent && !hash.startsWith('nohash:')) {
      const stored: StoredAutochart = { ...rec, addedAt: Date.now() };
      idbPutAutochart(stored).catch((e: unknown) => {
        console.error('autochart persist failed', e);
        ui.setStatus(
          `auto-charted "${job.fileName}" (but saving for next session failed)`,
          true,
        );
      });
    }
  };

  const hashOfJob = new Map<number, string>();

  const importAudioFile = async (file: File): Promise<void> => {
    // Cancel-and-replace: a running analysis is abandoned outright.
    if (pending.size > 0) {
      worker?.terminate();
      worker = null;
      pending.clear();
      hashOfJob.clear();
    }
    ui.showErrors([]);

    try {
      ui.setStatus(`reading "${file.name}"…`);
      const bytes = await file.arrayBuffer();

      const hash = await sha256Hex(bytes);
      if (hash) {
        // Cache hit → instant registration, no analysis.
        let cached: StoredAutochart | undefined;
        if (opts.persistent) {
          try {
            cached = await idbGetAutochart(hash);
          } catch (e) {
            console.error('autochart cache lookup failed', e);
          }
        }
        if (cached) {
          register(cached);
          ui.setStatus(`"${file.name}" already charted — loaded from cache`);
          return;
        }
      }

      ui.setProgress({ label: 'decoding audio…', percent: 3 });
      // decodeAudioData detaches `bytes`; nothing needs it afterwards (the
      // File itself is what gets stored and replayed).
      const audioBuf = await opts.audio.decodeAudioData(bytes);
      if (audioBuf.duration > MAX_DURATION_MIN * 60) {
        const mins = Math.round(audioBuf.duration / 60);
        throw new Error(
          `"${file.name}" is ~${mins} minutes long — auto-charting supports up to ${MAX_DURATION_MIN} minutes`,
        );
      }

      const mono = downmixToMono(audioBuf);
      const jobId = ++currentJobId;
      if (hash) hashOfJob.set(jobId, hash);

      const w = (worker ??= spawnWorker());
      const request: AnalyzeRequest = {
        type: 'analyze',
        jobId,
        samples: mono,
        sampleRate: audioBuf.sampleRate,
        title: file.name.replace(/\.[^.]+$/, ''),
        audioName: file.name,
      };
      ui.setProgress({ label: 'analyzing audio… 0%', percent: 5 });
      await new Promise<void>((resolve) => {
        pending.set(jobId, { fileName: file.name, audio: file, resolve });
        w.postMessage(request, [mono.buffer]);
      });
    } catch (e) {
      ui.setProgress(null);
      const message =
        e instanceof Error && e.name === 'EncodingError'
          ? `"${file.name}" could not be decoded — is it a valid MP3/OGG/WAV?`
          : e instanceof Error
            ? e.message
            : String(e);
      ui.showErrors([message]);
      ui.setStatus(`could not auto-chart "${file.name}"`, true);
    }
  };

  const remove = async (hash: string): Promise<void> => {
    const name = rows.get(hash)?.name ?? hash;
    registry.removeAutochart(hash);
    rows.delete(hash);
    ui.renderRows();
    ui.setStatus(`removed "${name}"`);
    ui.onContentChanged();
    if (opts.persistent) {
      try {
        await idbDeleteAutochart(hash);
      } catch (e) {
        console.error('autochart delete failed', e);
      }
    }
  };

  const restore = (recs: readonly StoredAutochart[]): string[] => {
    const errors: string[] = [];
    for (const rec of [...recs].sort((a, b) => a.addedAt - b.addedAt)) {
      try {
        // Cheap shape re-check, mirroring the stored-mods boot path.
        for (const d of AUTO_DIFFICULTIES) parseChart(rec.charts[d]);
        registry.registerAutochart(rec);
        rows.set(rec.hash, {
          hash: rec.hash,
          name: rec.fileName,
          summary: summarize(rec.charts),
        });
      } catch (e) {
        errors.push(
          `stored auto-chart "${rec.fileName}" failed to load: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    return errors;
  };

  return {
    importAudioFile,
    remove,
    restore,
    get rows() {
      return [...rows.values()];
    },
  };
}

/** Average all channels into one transferable Float32Array. */
function downmixToMono(buf: AudioBuffer): Float32Array<ArrayBuffer> {
  const mono = new Float32Array(buf.length);
  const scale = 1 / buf.numberOfChannels;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < mono.length; i++) mono[i] = mono[i]! + data[i]! * scale;
  }
  return mono;
}
