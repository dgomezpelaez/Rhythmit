/**
 * Song select — the home screen. Lists every registered song (built-ins
 * first, then mod content) and hands the pick to the character select.
 */

import { Container, Text } from 'pixi.js';
import type { Direction } from '../../engine/chart';
import { loadSelectedSongId, saveSelectedSongId } from '../../engine/settings';
import type { ContentRegistry, SongEntry } from '../../mods/registry';
import { ListView } from './listview';
import type { Screen } from './screen';

const LIST_WIDTH = 640;

export class SongSelectScreen implements Screen {
  readonly view = new Container();
  private readonly list: ListView;
  private songs: readonly SongEntry[] = [];

  constructor(
    private readonly registry: ContentRegistry,
    private readonly onPick: (song: SongEntry) => void,
    stageWidth: number,
    stageHeight: number,
  ) {
    const title = new Text({
      text: 'MONSTER FEEDER',
      style: { fill: '#ffffff', fontSize: 34, fontWeight: 'bold', letterSpacing: 4 },
    });
    title.anchor.set(0.5, 0);
    title.position.set(stageWidth / 2, 32);
    this.view.addChild(title);

    const subtitle = new Text({
      text: 'pick a song',
      style: { fill: '#9a9ab0', fontSize: 16 },
    });
    subtitle.anchor.set(0.5, 0);
    subtitle.position.set(stageWidth / 2, 76);
    this.view.addChild(subtitle);

    this.list = new ListView(LIST_WIDTH);
    this.list.view.position.set((stageWidth - LIST_WIDTH) / 2, 112);
    this.view.addChild(this.list.view);

    const help = new Text({
      text: '↑/↓ choose · Enter = pick monster · M = mods · C = calibrate · B = metronome',
      style: { fill: '#9a9ab0', fontSize: 14 },
    });
    help.anchor.set(0.5, 0);
    help.position.set(stageWidth / 2, stageHeight - 40);
    this.view.addChild(help);
  }

  refresh(): void {
    const selectedId = this.selected()?.id ?? loadSelectedSongId();
    this.songs = this.registry.songs;
    this.list.setItems(
      this.songs.map((s) => ({
        title: s.title,
        subtitle: `${s.artist} · ${s.difficulty} · ${s.chart.notes.length} notes`,
        tag: s.source,
      })),
      this.songs.findIndex((s) => s.id === selectedId),
    );
  }

  selected(): SongEntry | null {
    return this.songs[this.list.selectedIndex] ?? null;
  }

  enter(): void {
    this.refresh();
  }

  exit(): void {}

  update(): void {}

  onDir(dir: Direction): void {
    if (dir === 'up') this.list.move(-1);
    else if (dir === 'down') this.list.move(1);
  }

  onConfirm(): void {
    const song = this.selected();
    if (!song) return;
    saveSelectedSongId(song.id);
    this.onPick(song);
  }

  debugLabel(): string {
    const song = this.selected();
    return song
      ? `songselect ${this.list.selectedIndex + 1}/${this.list.count} "${song.title}" [${song.source}]`
      : 'songselect empty';
  }
}
