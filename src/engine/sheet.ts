/**
 * Spritesheet slicing. The atlas format is deliberately minimal: a uniform
 * grid described by frameWidth/frameHeight. Animations reference frames by
 * row-major grid index, which keeps character.json hand-writable.
 */

import { Rectangle, Texture, type TextureSource } from 'pixi.js';
import type { CharacterDef } from './character';
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

/** Slice a sheet into per-frame textures, row-major. */
export function sliceSheet(source: TextureSource, atlas: AtlasDef): Texture[] {
  const cols = Math.floor(source.pixelWidth / atlas.frameWidth);
  const rows = Math.floor(source.pixelHeight / atlas.frameHeight);
  if (cols === 0 || rows === 0) {
    throw new ValidationError(
      `spritesheet (${source.pixelWidth}x${source.pixelHeight}) is smaller ` +
        `than one ${atlas.frameWidth}x${atlas.frameHeight} frame`,
    );
  }
  const textures: Texture[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      textures.push(
        new Texture({
          source,
          frame: new Rectangle(
            col * atlas.frameWidth,
            row * atlas.frameHeight,
            atlas.frameWidth,
            atlas.frameHeight,
          ),
        }),
      );
    }
  }
  return textures;
}

/** A character ready to render: parsed def + sliced textures + voice audio. */
export interface LoadedCharacter {
  def: CharacterDef;
  textures: readonly Texture[];
  /** Reaction name → decoded voice clips (one is picked at random). */
  voice: ReadonlyMap<string, readonly AudioBuffer[]>;
}
