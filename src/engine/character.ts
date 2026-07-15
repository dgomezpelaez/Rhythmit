/**
 * Character definition — the modding contract for playable characters
 * (design doc §3.3). A character is a spritesheet + JSON; making a new
 * monster requires zero code. The engine treats this as a generic
 * "animated character" — what the animations *mean*, and which ones a game
 * requires (see missingAnimations), is the game layer's business.
 *
 * Extension over §3.3: an optional `eyes` block places two overlay pupils
 * (in frame-pixel coordinates) that the game moves at runtime to track
 * targets. Animations whose frames bake their own eye art list themselves
 * in `eyes.hiddenDuring` so the overlay disappears while they play.
 */

import {
  fail,
  requireBoolean,
  requireFiniteNumber,
  requireObject,
  requireString,
  ValidationError,
} from './validate';

export interface FrameAnimation {
  /** Spritesheet frame indices (row-major grid order, see sheet.ts). */
  frames: readonly number[];
  fps: number;
  loop: boolean;
}

export interface EyePoint {
  x: number;
  y: number;
}

export interface EyesDef {
  /** Pupil rest positions in frame pixels (origin = frame top-left). */
  left: EyePoint;
  right: EyePoint;
  /** Max pupil travel from the rest position, in frame pixels. */
  travel: number;
  pupilRadius: number;
  color: string;
  /** Animations that bake their own eye art; overlay pupils hide during these. */
  hiddenDuring: readonly string[];
}

export interface CharacterDef {
  id: string;
  name: string;
  spritesheet: string;
  atlas: string;
  animations: Readonly<Record<string, FrameAnimation>>;
  eyes?: EyesDef;
  /** Reaction name → voice clip file names (one is picked at random). */
  voice: Readonly<Record<string, readonly string[]>>;
}

/** Parse and validate a character.json. Throws with a readable message. */
export function parseCharacter(
  json: unknown,
  source = 'character.json',
): CharacterDef {
  const at = (path: string) => `${source}: ${path}`;
  const root = requireObject(json, at('character'));

  const id = requireString(root['id'], at('id'));
  const name = requireString(root['name'], at('name'));
  const spritesheet = requireString(root['spritesheet'], at('spritesheet'));
  const atlas = requireString(root['atlas'], at('atlas'));

  const animsRaw = requireObject(root['animations'], at('animations'));
  const animations: Record<string, FrameAnimation> = {};
  for (const [animName, value] of Object.entries(animsRaw)) {
    const path = at(`animations.${animName}`);
    const a = requireObject(value, path);

    const framesRaw = a['frames'];
    if (!Array.isArray(framesRaw) || framesRaw.length === 0) {
      fail(`${path}.frames`, 'expected a non-empty array');
    }
    const frames = framesRaw.map((f, i) => {
      const n = requireFiniteNumber(f, `${path}.frames[${i}]`);
      if (!Number.isInteger(n) || n < 0) {
        fail(`${path}.frames[${i}]`, 'expected a non-negative integer');
      }
      return n;
    });

    const fps = requireFiniteNumber(a['fps'], `${path}.fps`);
    if (fps <= 0) fail(`${path}.fps`, 'must be positive');

    const loop =
      a['loop'] === undefined ? false : requireBoolean(a['loop'], `${path}.loop`);

    animations[animName] = { frames, fps, loop };
  }
  if (Object.keys(animations).length === 0) {
    fail(at('animations'), 'expected at least one animation');
  }

  const eyes =
    root['eyes'] === undefined
      ? undefined
      : parseEyes(root['eyes'], at('eyes'), animations);

  const voice: Record<string, readonly string[]> = {};
  if (root['voice'] !== undefined) {
    const voiceRaw = requireObject(root['voice'], at('voice'));
    for (const [key, value] of Object.entries(voiceRaw)) {
      const path = at(`voice.${key}`);
      if (!Array.isArray(value) || value.length === 0) {
        fail(path, 'expected a non-empty array');
      }
      voice[key] = value.map((v, i) => requireString(v, `${path}[${i}]`));
    }
  }

  const def: CharacterDef = { id, name, spritesheet, atlas, animations, voice };
  if (eyes) def.eyes = eyes;
  return def;
}

function parseEyes(
  value: unknown,
  path: string,
  animations: Record<string, FrameAnimation>,
): EyesDef {
  const e = requireObject(value, path);

  const point = (v: unknown, p: string): EyePoint => {
    const o = requireObject(v, p);
    return {
      x: requireFiniteNumber(o['x'], `${p}.x`),
      y: requireFiniteNumber(o['y'], `${p}.y`),
    };
  };

  const travel = requireFiniteNumber(e['travel'], `${path}.travel`);
  if (travel < 0) fail(`${path}.travel`, 'must be >= 0');
  const pupilRadius = requireFiniteNumber(e['pupilRadius'], `${path}.pupilRadius`);
  if (pupilRadius <= 0) fail(`${path}.pupilRadius`, 'must be positive');

  const hiddenDuring: string[] = [];
  if (e['hiddenDuring'] !== undefined) {
    const raw = e['hiddenDuring'];
    if (!Array.isArray(raw)) fail(`${path}.hiddenDuring`, 'expected an array');
    for (let i = 0; i < raw.length; i++) {
      const name = requireString(raw[i], `${path}.hiddenDuring[${i}]`);
      if (!animations[name]) {
        fail(`${path}.hiddenDuring[${i}]`, `unknown animation "${name}"`);
      }
      hiddenDuring.push(name);
    }
  }

  return {
    left: point(e['left'], `${path}.left`),
    right: point(e['right'], `${path}.right`),
    travel,
    pupilRadius,
    color:
      e['color'] === undefined
        ? '#000000'
        : requireString(e['color'], `${path}.color`),
    hiddenDuring,
  };
}

/**
 * Check that every animation frame index exists on the sliced sheet.
 * Called after slicing, when the frame count is finally known.
 */
export function assertFramesInRange(
  def: CharacterDef,
  frameCount: number,
  source = 'character.json',
): void {
  for (const [name, anim] of Object.entries(def.animations)) {
    for (const frame of anim.frames) {
      if (frame >= frameCount) {
        throw new ValidationError(
          `${source}: animations.${name}: frame ${frame} out of range ` +
            `(spritesheet has ${frameCount} frames)`,
        );
      }
    }
  }
}

/** Frame index to show at elapsedMs into an animation (clamps or loops). */
export function frameAt(anim: FrameAnimation, elapsedMs: number): number {
  const i = Math.max(0, Math.floor((elapsedMs / 1000) * anim.fps));
  if (anim.loop) return anim.frames[i % anim.frames.length]!;
  return anim.frames[Math.min(i, anim.frames.length - 1)]!;
}

export function animationDurationMs(anim: FrameAnimation): number {
  return (anim.frames.length / anim.fps) * 1000;
}

/**
 * Names from `required` that have no animation in `def`. Which animations a
 * game requires is the game's business; this only does the checking.
 */
export function missingAnimations(
  def: CharacterDef,
  required: readonly string[],
): string[] {
  return required.filter((name) => !def.animations[name]);
}
