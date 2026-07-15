/**
 * Engine public API — the pure tier. Everything reachable from here is
 * renderer-agnostic: Web Audio timing, chart format, judgment, scoring,
 * and content validation. No pixi.js anywhere beneath this barrel; the
 * optional Pixi helpers live in ./pixi, the auto-chart pipeline in
 * ./autochart. Consumers (game/mods/main) import ONLY via these three
 * barrels — enforced by scripts/check-engine-boundary.mjs.
 */

export { AudioClock } from './audio';
export { Conductor } from './conductor';
export { parseChart } from './chart';
export type { Chart, Direction, Note, NoteType, SongMeta } from './chart';
export { HitJudge, WINDOWS, judgmentFor } from './judge';
export type { HitResult, Judgment, NoteState } from './judge';
export { ScoreState, gradeFor } from './score';
export type { Grade } from './score';
export { Hitstop } from './hitstop';
export { startRenderLoop } from './loop';
export {
  fail,
  requireBoolean,
  requireFiniteNumber,
  requireObject,
  requireString,
  ValidationError,
} from './validate';
export {
  animationDurationMs,
  assertFramesInRange,
  frameAt,
  missingAnimations,
  parseCharacter,
} from './character';
export type {
  CharacterDef,
  EyePoint,
  EyesDef,
  FrameAnimation,
} from './character';
export { parseAtlas } from './atlas';
export type { AtlasDef } from './atlas';
