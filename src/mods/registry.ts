/**
 * ContentRegistry — the single catalog of playable content. Built-ins and
 * mods register through it and the select screens read from it; gameplay
 * never knows where content came from. Charts and definitions are held
 * parsed; heavy assets (audio decode, spritesheet slicing, food textures)
 * materialize lazily on first use and are cached per entry.
 */

import { Texture } from 'pixi.js';
import { assertFramesInRange } from '../engine/character';
import type { Chart, Direction, Note } from '../engine/chart';
import {
  BUILT_IN_FOODS,
  colorToTint,
  DEFAULT_DIR_FOODS,
  type FoodDef,
} from '../engine/food';
import { sliceSheet, type LoadedCharacter } from '../engine/pixi/sheet';
import type { FileMap } from './files';
import type { ParsedFood, ParsedMod } from './validate';

export interface SongEntry {
  /** Namespaced: 'builtin:test' or '<modId>/<chartPath>'. */
  id: string;
  title: string;
  artist: string;
  difficulty: string;
  /** Shown as the list tag: 'built-in' or the mod's display name. */
  source: string;
  modId: string | null;
  chart: Chart;
  loadAudio(ctx: AudioContext): Promise<AudioBuffer>;
}

export interface CharacterEntry {
  /** Namespaced: 'builtin:chompo' or '<modId>/<characterId>'. */
  id: string;
  name: string;
  source: string;
  modId: string | null;
  load(ctx: AudioContext): Promise<LoadedCharacter>;
}

/** What gameplay needs to draw one food. */
export interface FoodVisual {
  tint: number;
  texture: Texture | null;
}

/** Every food a specific chart can show, textures preloaded. */
export interface ChartFoods {
  forNote(note: Note): FoodVisual;
  dirTints: Readonly<Record<Direction, number>>;
}

interface ModFood {
  def: FoodDef;
  imagePath: string | null;
  texture: Texture | null | undefined; // undefined = not loaded yet
}

interface RegisteredMod {
  name: string;
  files: FileMap;
  songs: SongEntry[];
  characters: CharacterEntry[];
  foods: Map<string, ModFood>;
  cachedTextures: Texture[];
}

const BUILT_IN_SOURCE = 'built-in';
const AUTOCHART_SOURCE = 'auto-chart';

/** What registerAutochart needs — matches StoredAutochart minus addedAt. */
export interface AutochartRecord {
  hash: string;
  fileName: string;
  audio: Blob;
  charts: Readonly<Record<string, Chart>>;
}

export class ContentRegistry {
  private builtInSongs: SongEntry[] = [];
  private builtInCharacters: CharacterEntry[] = [];
  private readonly builtInFoods = new Map<string, FoodDef>(
    BUILT_IN_FOODS.map((f) => [f.id, f]),
  );
  /** Insertion order = registration order; built-ins listed first. */
  private readonly mods = new Map<string, RegisteredMod>();
  /** Auto-charted songs, keyed by audio hash; listed after mods. */
  private readonly autocharts = new Map<string, SongEntry[]>();

  get songs(): readonly SongEntry[] {
    return [
      ...this.builtInSongs,
      ...[...this.mods.values()].flatMap((m) => m.songs),
      ...[...this.autocharts.values()].flat(),
    ];
  }

  get characters(): readonly CharacterEntry[] {
    return [
      ...this.builtInCharacters,
      ...[...this.mods.values()].flatMap((m) => m.characters),
    ];
  }

  get modIds(): readonly string[] {
    return [...this.mods.keys()];
  }

  findSong(id: string): SongEntry | null {
    return this.songs.find((s) => s.id === id) ?? null;
  }

  findCharacter(id: string): CharacterEntry | null {
    return this.characters.find((c) => c.id === id) ?? null;
  }

  registerBuiltInSong(opts: {
    key: string;
    chart: Chart;
    loadAudio: (ctx: AudioContext) => Promise<AudioBuffer>;
  }): void {
    this.builtInSongs.push({
      id: `builtin:${opts.key}`,
      title: opts.chart.song.title,
      artist: opts.chart.song.artist,
      difficulty: opts.chart.difficulty,
      source: BUILT_IN_SOURCE,
      modId: null,
      chart: opts.chart,
      loadAudio: cached(opts.loadAudio),
    });
  }

  registerBuiltInCharacter(opts: {
    key: string;
    name: string;
    load: (ctx: AudioContext) => Promise<LoadedCharacter>;
  }): void {
    this.builtInCharacters.push({
      id: `builtin:${opts.key}`,
      name: opts.name,
      source: BUILT_IN_SOURCE,
      modId: null,
      load: cached(opts.load),
    });
  }

  /** Register a validated mod; a mod with the same id is replaced. */
  registerMod(parsed: ParsedMod, files: FileMap): void {
    const modId = parsed.manifest.id;
    this.removeMod(modId);

    const mod: RegisteredMod = {
      name: parsed.manifest.name,
      files,
      songs: [],
      characters: [],
      foods: new Map(
        parsed.foods.map((f: ParsedFood) => [
          f.def.id,
          { def: f.def, imagePath: f.imagePath, texture: undefined },
        ]),
      ),
      cachedTextures: [],
    };

    for (const song of parsed.songs) {
      mod.songs.push({
        id: `${modId}/${song.chartPath}`,
        title: song.chart.song.title,
        artist: song.chart.song.artist,
        difficulty: song.chart.difficulty,
        source: mod.name,
        modId,
        chart: song.chart,
        loadAudio: cached((ctx) => decodeBlob(ctx, files, song.audioPath)),
      });
    }

    for (const character of parsed.characters) {
      mod.characters.push({
        id: `${modId}/${character.def.id}`,
        name: character.def.name,
        source: mod.name,
        modId,
        load: cached(async (ctx) => {
          const sheetBlob = files.get(character.sheetPath)!;
          const bitmap = await createImageBitmap(sheetBlob);
          const texture = Texture.from(bitmap);
          mod.cachedTextures.push(texture);
          const textures = sliceSheet(texture.source, character.atlas);
          assertFramesInRange(character.def, textures.length, character.jsonPath);

          const voice = new Map<string, readonly AudioBuffer[]>();
          for (const [reaction, paths] of character.voicePaths) {
            const clips = await Promise.all(
              paths.map((p) => decodeBlob(ctx, files, p)),
            );
            if (clips.length > 0) voice.set(reaction, clips);
          }
          return { def: character.def, textures, voice };
        }),
      });
    }

    this.mods.set(modId, mod);
  }

  /**
   * Register an auto-charted song: one SongEntry per difficulty, all sharing
   * the same lazily-decoded audio Blob. Re-registering a hash replaces it.
   */
  registerAutochart(rec: AutochartRecord): void {
    // decodeAudioData detaches its buffer — blob.arrayBuffer() is fresh per
    // call, and cached() ensures we decode once per entry set.
    const loadAudio = cached(async (ctx: AudioContext) =>
      ctx.decodeAudioData(await rec.audio.arrayBuffer()),
    );
    this.autocharts.set(
      rec.hash,
      Object.entries(rec.charts).map(([difficulty, chart]) => ({
        id: `autochart:${rec.hash}:${difficulty}`,
        title: chart.song.title,
        artist: chart.song.artist,
        difficulty,
        source: AUTOCHART_SOURCE,
        modId: null,
        chart,
        loadAudio,
      })),
    );
  }

  removeAutochart(hash: string): void {
    this.autocharts.delete(hash);
  }

  removeMod(modId: string): void {
    const mod = this.mods.get(modId);
    if (!mod) return;
    for (const texture of mod.cachedTextures) texture.destroy(true);
    for (const food of mod.foods.values()) food.texture?.destroy(true);
    this.mods.delete(modId);
  }

  /**
   * Resolve and preload every food a chart can show. A mod's chart sees its
   * own foods first, then built-ins; built-ins cover everything else.
   */
  async buildChartFoods(song: SongEntry): Promise<ChartFoods> {
    const mod = song.modId ? this.mods.get(song.modId) : undefined;

    const resolve = async (id: string): Promise<FoodVisual | null> => {
      const modFood = mod?.foods.get(id);
      if (modFood) {
        if (modFood.texture === undefined) {
          modFood.texture = modFood.imagePath
            ? Texture.from(await createImageBitmap(mod!.files.get(modFood.imagePath)!))
            : null;
        }
        return { tint: colorToTint(modFood.def.color), texture: modFood.texture };
      }
      const builtIn = this.builtInFoods.get(id);
      return builtIn ? { tint: colorToTint(builtIn.color), texture: null } : null;
    };

    const byId = new Map<string, FoodVisual>();
    const wanted = new Set<string>(Object.values(DEFAULT_DIR_FOODS));
    for (const id of Object.values(song.chart.foods ?? {})) wanted.add(id);
    for (const note of song.chart.notes) if (note.food) wanted.add(note.food);
    for (const id of wanted) {
      const visual = await resolve(id);
      if (visual) byId.set(id, visual);
    }

    const idForDir = (dir: Direction): string => {
      const mapped = song.chart.foods?.[dir];
      return mapped && byId.has(mapped) ? mapped : DEFAULT_DIR_FOODS[dir];
    };

    const dirTints = {} as Record<Direction, number>;
    for (const dir of ['left', 'right', 'up', 'down'] as const) {
      dirTints[dir] = byId.get(idForDir(dir))!.tint;
    }

    return {
      dirTints,
      forNote: (note: Note): FoodVisual => {
        const id = note.food && byId.has(note.food) ? note.food : idForDir(note.dir);
        return byId.get(id)!;
      },
    };
  }
}

/** Memoize an async loader; concurrent callers share one in-flight promise. */
function cached<T>(
  load: (ctx: AudioContext) => Promise<T>,
): (ctx: AudioContext) => Promise<T> {
  let promise: Promise<T> | null = null;
  return (ctx) => (promise ??= load(ctx));
}

async function decodeBlob(
  ctx: AudioContext,
  files: FileMap,
  path: string,
): Promise<AudioBuffer> {
  const blob = files.get(path);
  if (!blob) throw new Error(`mod file missing: ${path}`);
  // decodeAudioData detaches its buffer — always pass a fresh copy.
  return ctx.decodeAudioData(await blob.arrayBuffer());
}
