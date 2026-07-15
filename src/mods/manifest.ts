/**
 * mod.json — the manifest at the root of every mod. Lists the mod's
 * identity and the entry JSON of each piece of content. All paths are
 * relative to the mod root.
 */

import { fail, requireObject, requireString } from '../engine/validate';
import { normalizePath } from './files';

export interface ModManifest {
  version: 1;
  id: string;
  name: string;
  author: string;
  /** Paths to chart.json files. */
  songs: string[];
  /** Paths to character.json files. */
  characters: string[];
  /** Paths to foods.json files. */
  foods: string[];
}

const ID_RE = /^[a-z0-9-]+$/;

/** Parse and validate a mod.json. Throws with a readable message. */
export function parseModManifest(json: unknown, source = 'mod.json'): ModManifest {
  const at = (path: string) => `${source}: ${path}`;
  const root = requireObject(json, at('manifest'));

  const version = root['version'];
  if (version !== 1) {
    fail(at('version'), `unsupported version ${JSON.stringify(version)} (expected 1)`);
  }

  const id = requireString(root['id'], at('id'));
  if (!ID_RE.test(id)) {
    fail(at('id'), `"${id}" must be lowercase letters, digits and dashes (e.g. "my-cool-mod")`);
  }

  const pathList = (key: 'songs' | 'characters' | 'foods'): string[] => {
    const raw = root[key];
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) fail(at(key), 'expected an array of file paths');
    return raw.map((v, i) => normalizePath(requireString(v, at(`${key}[${i}]`))));
  };

  const manifest: ModManifest = {
    version: 1,
    id,
    name: requireString(root['name'], at('name')),
    author:
      root['author'] === undefined
        ? 'unknown'
        : requireString(root['author'], at('author')),
    songs: pathList('songs'),
    characters: pathList('characters'),
    foods: pathList('foods'),
  };

  if (
    manifest.songs.length + manifest.characters.length + manifest.foods.length ===
    0
  ) {
    fail(at('manifest'), 'mod declares no content — add songs, characters or foods');
  }
  return manifest;
}
