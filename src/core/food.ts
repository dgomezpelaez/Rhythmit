/**
 * Food definitions — the third moddable content type (after charts and
 * characters). A food is what flies at the monster: a display color (used
 * for particles, splats and the drawn fallback) plus an optional sprite
 * image. Charts pick foods per note (`note.food`) or per direction
 * (`chart.foods`); anything unmapped falls back to the built-in food for
 * that direction.
 */

import type { Direction } from './chart';
import { fail, requireObject, requireString } from './validate';

export interface FoodDef {
  id: string;
  name: string;
  /** '#rrggbb' — particle/splat tint and the fallback circle fill. */
  color: string;
  /** Optional sprite file, relative to the foods.json that declares it. */
  image?: string;
}

/** The four default foods; same colors gameplay always used per direction. */
export const BUILT_IN_FOODS: readonly FoodDef[] = [
  { id: 'taffy', name: 'Taffy', color: '#ffd166' },
  { id: 'berry', name: 'Berry', color: '#ff5c8a' },
  { id: 'icepop', name: 'Ice Pop', color: '#66d9ff' },
  { id: 'lime', name: 'Lime Drop', color: '#9dff6b' },
];

export const DEFAULT_DIR_FOODS: Readonly<Record<Direction, string>> = {
  left: 'taffy',
  right: 'berry',
  up: 'icepop',
  down: 'lime',
};

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** '#rrggbb' → 0xrrggbb for Pixi tints. */
export function colorToTint(color: string): number {
  return Number.parseInt(color.slice(1), 16);
}

/** Parse and validate a foods.json. Throws with a readable message. */
export function parseFoods(json: unknown, source = 'foods.json'): FoodDef[] {
  const at = (path: string) => `${source}: ${path}`;
  const root = requireObject(json, at('foods file'));

  const version = root['version'];
  if (version !== 1) {
    fail(at('version'), `unsupported version ${JSON.stringify(version)} (expected 1)`);
  }

  const listRaw = root['foods'];
  if (!Array.isArray(listRaw) || listRaw.length === 0) {
    fail(at('foods'), 'expected a non-empty array');
  }

  const seen = new Set<string>();
  return listRaw.map((raw, i) => {
    const path = at(`foods[${i}]`);
    const f = requireObject(raw, path);

    const id = requireString(f['id'], `${path}.id`);
    if (!/^[a-z0-9-]+$/.test(id)) {
      fail(`${path}.id`, `"${id}" must be lowercase letters, digits and dashes`);
    }
    if (seen.has(id)) fail(`${path}.id`, `duplicate food id "${id}"`);
    seen.add(id);

    const color = requireString(f['color'], `${path}.color`);
    if (!COLOR_RE.test(color)) {
      fail(`${path}.color`, `"${color}" is not a #rrggbb color`);
    }

    const def: FoodDef = {
      id,
      name: requireString(f['name'], `${path}.name`),
      color,
    };
    if (f['image'] !== undefined) {
      def.image = requireString(f['image'], `${path}.image`);
    }
    return def;
  });
}
