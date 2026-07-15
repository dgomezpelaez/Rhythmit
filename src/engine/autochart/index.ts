/**
 * Auto-chart public API: spawn the analysis worker, talk to it with the
 * message types, receive charts per difficulty. DSP internals (fft,
 * onsets, bpm) are private. worker.ts is a side-effectful worker entry —
 * it must never be re-exported here; only spawn.ts references it.
 */

export { AUTO_DIFFICULTIES } from './generate';
export type { AutoDifficulty } from './generate';
export { createAutochartWorker } from './spawn';
export type { AnalyzePhase, AnalyzeRequest, WorkerReply } from './messages';
