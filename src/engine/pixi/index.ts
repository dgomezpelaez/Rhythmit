/**
 * Engine Pixi tier — the only engine code allowed to import pixi.js.
 * Optional: a game on another renderer skips this barrel entirely.
 */

export { ParticleSystem } from './particles';
export type { BurstOptions } from './particles';
export { sliceSheet } from './sheet';
export type { LoadedCharacter } from './sheet';
