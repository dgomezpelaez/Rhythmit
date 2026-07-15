/**
 * Spritesheet slicing — the Pixi-dependent half of the atlas story. The
 * grid format itself is parsed in ../atlas.ts (pure JSON, no Pixi).
 */

import { Rectangle, Texture, type TextureSource } from 'pixi.js';
import type { AtlasDef } from '../atlas';
import type { CharacterDef } from '../character';
import { ValidationError } from '../validate';

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
