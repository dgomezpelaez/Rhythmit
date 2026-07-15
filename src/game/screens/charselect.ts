/**
 * Character select — second step after picking a song. Lists every
 * registered character with a live idle-animation preview of the
 * highlighted one (loads lazily; cached loads make revisits instant).
 */

import { Container, Sprite, Text, Texture } from 'pixi.js';
import { frameAt } from '../../engine/character';
import type { Direction } from '../../engine/chart';
import {
  loadSelectedCharacterId,
  saveSelectedCharacterId,
} from '../../engine/settings';
import type { LoadedCharacter } from '../../engine/pixi/sheet';
import type { CharacterEntry, ContentRegistry } from '../../mods/registry';
import { ListView } from './listview';
import type { Screen } from './screen';

const LIST_WIDTH = 460;
const PREVIEW_SIZE = 220;

export class CharacterSelectScreen implements Screen {
  readonly view = new Container();
  private readonly list: ListView;
  private readonly preview: Sprite;
  private readonly previewName: Text;
  private characters: readonly CharacterEntry[] = [];
  private previewFor: CharacterEntry | null = null;
  private previewLoaded: LoadedCharacter | null = null;
  private previewStart = 0;

  constructor(
    private readonly registry: ContentRegistry,
    private readonly audio: AudioContext,
    private readonly onPick: (character: CharacterEntry) => void,
    stageWidth: number,
    stageHeight: number,
  ) {
    const title = new Text({
      text: 'pick a monster',
      style: { fill: '#ffffff', fontSize: 26, fontWeight: 'bold' },
    });
    title.anchor.set(0.5, 0);
    title.position.set(stageWidth / 2, 36);
    this.view.addChild(title);

    this.list = new ListView(LIST_WIDTH);
    this.list.view.position.set(64, 100);
    this.view.addChild(this.list.view);

    this.preview = new Sprite();
    this.preview.anchor.set(0.5);
    this.preview.position.set(
      stageWidth - 64 - PREVIEW_SIZE / 2,
      100 + PREVIEW_SIZE / 2,
    );
    this.view.addChild(this.preview);

    this.previewName = new Text({
      text: '',
      style: { fill: '#9a9ab0', fontSize: 16 },
    });
    this.previewName.anchor.set(0.5, 0);
    this.previewName.position.set(
      stageWidth - 64 - PREVIEW_SIZE / 2,
      110 + PREVIEW_SIZE,
    );
    this.view.addChild(this.previewName);

    const help = new Text({
      text: '↑/↓ choose · Enter = play · Esc = back to songs',
      style: { fill: '#9a9ab0', fontSize: 14 },
    });
    help.anchor.set(0.5, 0);
    help.position.set(stageWidth / 2, stageHeight - 40);
    this.view.addChild(help);
  }

  refresh(): void {
    const selectedId = this.selected()?.id ?? loadSelectedCharacterId();
    this.characters = this.registry.characters;
    this.list.setItems(
      this.characters.map((c) => ({
        title: c.name,
        subtitle: c.modId ? `from ${c.source}` : 'the original',
        tag: c.source,
      })),
      this.characters.findIndex((c) => c.id === selectedId),
    );
    this.updatePreviewTarget();
  }

  selected(): CharacterEntry | null {
    return this.characters[this.list.selectedIndex] ?? null;
  }

  enter(): void {
    this.refresh();
  }

  exit(): void {}

  update(): void {
    const loaded = this.previewLoaded;
    if (!loaded) return;
    const idle = loaded.def.animations['idle'];
    if (!idle) return;
    const frame = frameAt(idle, performance.now() - this.previewStart);
    const texture = loaded.textures[frame];
    if (texture && this.preview.texture !== texture) {
      this.preview.texture = texture;
      const scale = PREVIEW_SIZE / Math.max(texture.width, texture.height);
      this.preview.scale.set(scale);
    }
  }

  onDir(dir: Direction): void {
    if (dir === 'up') this.list.move(-1);
    else if (dir === 'down') this.list.move(1);
    else return;
    this.updatePreviewTarget();
  }

  onConfirm(): void {
    const character = this.selected();
    if (!character) return;
    saveSelectedCharacterId(character.id);
    this.onPick(character);
  }

  debugLabel(): string {
    const c = this.selected();
    return c
      ? `charselect ${this.list.selectedIndex + 1}/${this.list.count} "${c.name}" [${c.source}]`
      : 'charselect empty';
  }

  private updatePreviewTarget(): void {
    const target = this.selected();
    if (target === this.previewFor) return;
    this.previewFor = target;
    this.previewLoaded = null;
    this.preview.texture = Texture.EMPTY;
    this.previewName.text = target ? target.name : '';
    if (!target) return;
    void target
      .load(this.audio)
      .then((loaded) => {
        // The highlight may have moved on while we loaded.
        if (this.previewFor === target) {
          this.previewLoaded = loaded;
          this.previewStart = performance.now();
        }
      })
      .catch((e) => {
        if (this.previewFor === target) {
          this.previewName.text = `${target.name} (failed to load)`;
          console.error('character preview load failed', e);
        }
      });
  }
}
