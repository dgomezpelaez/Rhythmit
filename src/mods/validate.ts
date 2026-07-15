/**
 * Whole-mod validation. Runs at import time (drop / file pick) and checks
 * everything eagerly — JSON schemas, referenced files, that every image
 * and audio file actually decodes, that animation frames fit the sheet —
 * collecting ALL problems into one human-readable list instead of dying on
 * the first. A broken mod must explain itself at drop time, never explode
 * mid-song. Modder experience is user experience.
 */

import {
  assertFramesInRange,
  missingAnimations,
  parseAtlas,
  parseCharacter,
  parseChart,
  type AtlasDef,
  type CharacterDef,
  type Chart,
} from '../engine';
import { BUILT_IN_FOODS, parseFoods, type FoodDef } from '../game/food';
import { REQUIRED_ANIMATIONS } from '../game/monster/animations';
import { resolveRelative, type FileMap } from './files';
import { parseModManifest, type ModManifest } from './manifest';

export interface ParsedSong {
  chartPath: string;
  chart: Chart;
  /** Mod-root-relative path of the decodable audio file. */
  audioPath: string;
}

export interface ParsedCharacter {
  jsonPath: string;
  def: CharacterDef;
  atlas: AtlasDef;
  sheetPath: string;
  /** Voice reaction name → mod-root-relative clip paths. */
  voicePaths: ReadonlyMap<string, readonly string[]>;
}

export interface ParsedFood {
  def: FoodDef;
  /** Mod-root-relative image path, or null for the drawn fallback. */
  imagePath: string | null;
}

export interface ParsedMod {
  manifest: ModManifest;
  songs: ParsedSong[];
  characters: ParsedCharacter[];
  foods: ParsedFood[];
}

export type ModValidation =
  | { ok: true; parsed: ParsedMod }
  | { ok: false; errors: string[] };

export interface ValidateOptions {
  /**
   * Decode every image/audio file to prove the browser can play it.
   * True at import time (drop); false when re-registering already-vetted
   * mods from IndexedDB on boot, where decoding everything would be slow.
   */
  decodeAssets: boolean;
}

/** Validate an entire mod. Never throws; all problems land in `errors`. */
export async function validateMod(
  files: FileMap,
  audio: BaseAudioContext,
  opts: ValidateOptions = { decodeAssets: true },
): Promise<ModValidation> {
  const errors: string[] = [];

  const manifest = await parseManifestFile(files, errors);
  if (!manifest) return { ok: false, errors };

  // Foods first: charts reference food ids.
  const foods: ParsedFood[] = [];
  const foodIds = new Set(BUILT_IN_FOODS.map((f) => f.id));
  for (const path of manifest.foods) {
    const parsed = await tryItem(errors, () =>
      loadFoods(files, path, foodIds, opts.decodeAssets),
    );
    if (parsed) foods.push(...parsed);
  }

  const songs: ParsedSong[] = [];
  for (const path of manifest.songs) {
    const parsed = await tryItem(errors, () =>
      loadSong(files, path, audio, foodIds, errors, opts.decodeAssets),
    );
    if (parsed) songs.push(parsed);
  }

  const characters: ParsedCharacter[] = [];
  const characterIds = new Set<string>();
  for (const path of manifest.characters) {
    const parsed = await tryItem(errors, () =>
      loadCharacter(files, path, audio, errors, opts.decodeAssets),
    );
    if (!parsed) continue;
    if (characterIds.has(parsed.def.id)) {
      errors.push(`${path}: duplicate character id "${parsed.def.id}" within this mod`);
      continue;
    }
    characterIds.add(parsed.def.id);
    characters.push(parsed);
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, parsed: { manifest, songs, characters, foods } };
}

// ---------------------------------------------------------------------------

/** Manifest failure is terminal: nothing else is addressable without it. */
async function parseManifestFile(
  files: FileMap,
  errors: string[],
): Promise<ModManifest | null> {
  if (!files.has('mod.json')) {
    errors.push(
      'mod.json: not found at the mod root — every mod needs a mod.json manifest',
    );
    return null;
  }
  return tryItem(errors, async () =>
    parseModManifest(await readJson(files, 'mod.json')),
  );
}

async function tryItem<T>(
  errors: string[],
  run: () => Promise<T> | T,
): Promise<T | null> {
  try {
    return await run();
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
    return null;
  }
}

function requireBlob(files: FileMap, path: string, referrer: string): Blob {
  const blob = files.get(path);
  if (!blob) {
    throw new Error(`${referrer}: references "${path}" but that file is not in the mod`);
  }
  return blob;
}

async function readJson(files: FileMap, path: string, referrer?: string): Promise<unknown> {
  const blob = requireBlob(files, path, referrer ?? path);
  const text = await blob.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${path}: not valid JSON (${e instanceof Error ? e.message : e})`);
  }
}

async function checkAudioDecodes(
  files: FileMap,
  path: string,
  audio: BaseAudioContext,
  referrer: string,
  decode: boolean,
): Promise<void> {
  const blob = requireBlob(files, path, referrer);
  if (!decode) return;
  try {
    // decodeAudioData detaches the buffer — always hand it a fresh copy.
    await audio.decodeAudioData(await blob.arrayBuffer());
  } catch {
    throw new Error(
      `${referrer}: audio "${path}" could not be decoded by this browser — use .wav or .mp3`,
    );
  }
}

async function checkImageDecodes(
  files: FileMap,
  path: string,
  referrer: string,
  decode: boolean,
): Promise<ImageBitmap | null> {
  const blob = requireBlob(files, path, referrer);
  if (!decode) return null;
  try {
    return await createImageBitmap(blob);
  } catch {
    throw new Error(`${referrer}: image "${path}" is not a decodable image — use .png`);
  }
}

// ---------------------------------------------------------------------------

async function loadFoods(
  files: FileMap,
  path: string,
  foodIds: Set<string>,
  decode: boolean,
): Promise<ParsedFood[]> {
  const defs = parseFoods(await readJson(files, path), path);
  const out: ParsedFood[] = [];
  for (const def of defs) {
    if (foodIds.has(def.id)) {
      throw new Error(
        `${path}: food id "${def.id}" already exists (built-ins: ${BUILT_IN_FOODS.map((f) => f.id).join(', ')})`,
      );
    }
    foodIds.add(def.id);
    let imagePath: string | null = null;
    if (def.image !== undefined) {
      imagePath = resolveRelative(path, def.image);
      const bitmap = await checkImageDecodes(files, imagePath, path, decode);
      bitmap?.close();
    }
    out.push({ def, imagePath });
  }
  return out;
}

async function loadSong(
  files: FileMap,
  path: string,
  audio: BaseAudioContext,
  foodIds: ReadonlySet<string>,
  errors: string[],
  decode: boolean,
): Promise<ParsedSong | null> {
  let chart: Chart;
  try {
    chart = parseChart(await readJson(files, path));
  } catch (e) {
    // Prefix core parser errors (whose paths are chart-relative) with the file.
    throw new Error(prefixed(path, e));
  }

  let ok = true;
  const audioPath = resolveRelative(path, chart.song.audio);
  const audioCheck = await tryItem(errors, () =>
    checkAudioDecodes(files, audioPath, audio, path, decode),
  );
  if (audioCheck === null) ok = false;

  const badFood = (id: string, where: string) => {
    errors.push(
      `${path}: ${where}: unknown food "${id}" — declare it in this mod's foods.json or use a built-in`,
    );
    ok = false;
  };
  for (const [dir, id] of Object.entries(chart.foods ?? {})) {
    if (!foodIds.has(id)) badFood(id, `foods.${dir}`);
  }
  chart.notes.forEach((note, i) => {
    if (note.food !== undefined && !foodIds.has(note.food)) {
      badFood(note.food, `notes[${i}].food`);
    }
  });

  return ok ? { chartPath: path, chart, audioPath } : null;
}

async function loadCharacter(
  files: FileMap,
  path: string,
  audio: BaseAudioContext,
  errors: string[],
  decode: boolean,
): Promise<ParsedCharacter | null> {
  const def = parseCharacter(await readJson(files, path), path);

  let ok = true;
  const missing = missingAnimations(def, REQUIRED_ANIMATIONS);
  for (const name of missing) {
    errors.push(
      `${path}: animation '${name}' missing (required: ${REQUIRED_ANIMATIONS.join(', ')})`,
    );
    ok = false;
  }

  const atlasPath = resolveRelative(path, def.atlas);
  const atlas = await tryItem(errors, async () =>
    parseAtlas(await readJson(files, atlasPath, path), atlasPath),
  );

  const sheetPath = resolveRelative(path, def.spritesheet);
  const bitmap = await tryItem(errors, () =>
    checkImageDecodes(files, sheetPath, path, decode),
  );

  if (atlas && bitmap) {
    const cols = Math.floor(bitmap.width / atlas.frameWidth);
    const rows = Math.floor(bitmap.height / atlas.frameHeight);
    if (cols === 0 || rows === 0) {
      errors.push(
        `${path}: spritesheet "${sheetPath}" (${bitmap.width}x${bitmap.height}) is smaller ` +
          `than one ${atlas.frameWidth}x${atlas.frameHeight} frame`,
      );
      ok = false;
    } else {
      const framesOk = await tryItem(errors, () =>
        assertFramesInRange(def, cols * rows, path),
      );
      if (framesOk === null) ok = false;
    }
  }
  bitmap?.close();

  const voicePaths = new Map<string, readonly string[]>();
  for (const [reaction, clips] of Object.entries(def.voice)) {
    const resolved: string[] = [];
    for (const clip of clips) {
      const clipPath = resolveRelative(path, clip);
      const decoded = await tryItem(errors, () =>
        checkAudioDecodes(files, clipPath, audio, path, decode),
      );
      if (decoded === null) ok = false;
      else resolved.push(clipPath);
    }
    voicePaths.set(reaction, resolved);
  }

  if (!ok || !atlas) return null;
  return { jsonPath: path, def, atlas, sheetPath, voicePaths };
}

function prefixed(path: string, e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.startsWith(path) ? msg : `${path}: ${msg}`;
}
