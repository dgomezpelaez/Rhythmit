/**
 * Atlas format — a spritesheet described as a uniform grid by
 * frameWidth/frameHeight. Animations reference frames by row-major grid
 * index, which keeps character.json hand-writable. Pure JSON parsing;
 * the Pixi-dependent slicing lives in pixi/sheet.ts.
 */

import { requireFiniteNumber, requireObject, ValidationError } from './validate';

export interface AtlasDef {
  frameWidth: number;
  frameHeight: number;
}

/** Parse and validate an atlas.json. Throws with a readable message. */
export function parseAtlas(json: unknown, source = 'atlas.json'): AtlasDef {
  const root = requireObject(json, source);
  const dim = (key: string): number => {
    const n = requireFiniteNumber(root[key], `${source}: ${key}`);
    if (!Number.isInteger(n) || n <= 0) {
      throw new ValidationError(`${source}: ${key}: expected a positive integer`);
    }
    return n;
  };
  return { frameWidth: dim('frameWidth'), frameHeight: dim('frameHeight') };
}
