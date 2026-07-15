/**
 * Worker factory for the auto-chart analysis pipeline. The
 * `new Worker(new URL(...))` literal must stay in this file: bundlers
 * (Vite included) statically rewrite exactly this pattern, and it is the
 * form that survives a relative `base` ('./') in production builds.
 */

export function createAutochartWorker(): Worker {
  return new Worker(new URL('./worker.ts', import.meta.url), {
    type: 'module',
  });
}
