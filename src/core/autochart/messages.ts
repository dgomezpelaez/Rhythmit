/**
 * Message protocol between the main thread and the auto-chart worker.
 * Charts travel back as plain JSON (structured-clone-safe); the sample
 * buffer travels in as a transferable.
 */

import type { Chart } from '../chart';
import type { AutoDifficulty } from './generate';

export interface AnalyzeRequest {
  type: 'analyze';
  jobId: number;
  /** Mono PCM, transferred (the sender's copy is detached). */
  samples: Float32Array;
  sampleRate: number;
  /** Song title (file name sans extension). */
  title: string;
  /** Value for SongMeta.audio — the original file name. */
  audioName: string;
}

export type AnalyzePhase = 'analyzing' | 'detecting' | 'building';

export type WorkerReply =
  | { type: 'progress'; jobId: number; phase: AnalyzePhase; percent: number }
  | { type: 'done'; jobId: number; bpm: number; charts: Record<AutoDifficulty, Chart> }
  | { type: 'error'; jobId: number; message: string };
