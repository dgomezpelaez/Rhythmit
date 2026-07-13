/**
 * ListView — the shared Pixi list widget behind the song and character
 * select screens: title + subtitle rows with a right-aligned source tag,
 * a highlight bar, wrap-around up/down navigation and a scroll window.
 */

import { Container, Graphics, Text } from 'pixi.js';

export interface ListItem {
  title: string;
  subtitle: string;
  /** 'built-in' or the mod name; drawn as a muted right-aligned pill. */
  tag: string;
}

const ROW_H = 52;
const VISIBLE_ROWS = 7;

export class ListView {
  readonly view = new Container();
  private readonly rowLayer = new Container();
  private readonly highlight: Graphics;
  private readonly emptyText: Text;
  private items: ListItem[] = [];
  private index = 0;
  private scrollTop = 0;

  constructor(private readonly width: number) {
    this.highlight = new Graphics()
      .roundRect(0, 0, width, ROW_H - 6, 10)
      .fill({ color: 0x7a5cff, alpha: 0.22 })
      .stroke({ width: 2, color: 0x7a5cff, alpha: 0.7 });
    this.view.addChild(this.highlight);
    this.view.addChild(this.rowLayer);

    this.emptyText = new Text({
      text: 'nothing here yet',
      style: { fill: '#9a9ab0', fontSize: 16 },
    });
    this.emptyText.visible = false;
    this.view.addChild(this.emptyText);
  }

  get selectedIndex(): number {
    return this.index;
  }

  get count(): number {
    return this.items.length;
  }

  selected(): ListItem | null {
    return this.items[this.index] ?? null;
  }

  /** Replace the items; keepIndex (if >= 0) becomes the new selection. */
  setItems(items: ListItem[], keepIndex = -1): void {
    this.items = items;
    this.index =
      keepIndex >= 0 && keepIndex < items.length
        ? keepIndex
        : Math.min(this.index, Math.max(0, items.length - 1));
    this.rebuild();
  }

  move(delta: number): void {
    if (this.items.length === 0) return;
    this.index = (this.index + delta + this.items.length) % this.items.length;
    this.rebuild();
  }

  private rebuild(): void {
    // Keep the selection inside the visible window.
    if (this.index < this.scrollTop) this.scrollTop = this.index;
    if (this.index >= this.scrollTop + VISIBLE_ROWS) {
      this.scrollTop = this.index - VISIBLE_ROWS + 1;
    }
    this.scrollTop = Math.max(0, Math.min(this.scrollTop, Math.max(0, this.items.length - VISIBLE_ROWS)));

    this.rowLayer.removeChildren();
    this.emptyText.visible = this.items.length === 0;
    this.highlight.visible = this.items.length > 0;

    const end = Math.min(this.items.length, this.scrollTop + VISIBLE_ROWS);
    for (let i = this.scrollTop; i < end; i++) {
      const item = this.items[i]!;
      const y = (i - this.scrollTop) * ROW_H;
      const row = new Container();
      row.y = y;

      const title = new Text({
        text: item.title,
        style: { fill: '#ffffff', fontSize: 19, fontWeight: 'bold' },
      });
      title.position.set(16, 5);
      row.addChild(title);

      const subtitle = new Text({
        text: item.subtitle,
        style: { fill: '#9a9ab0', fontSize: 13 },
      });
      subtitle.position.set(16, 27);
      row.addChild(subtitle);

      const tag = new Text({
        text: item.tag,
        style: { fill: item.tag === 'built-in' ? '#9a9ab0' : '#b9a5ff', fontSize: 12 },
      });
      tag.anchor.set(1, 0.5);
      tag.position.set(this.width - 16, (ROW_H - 6) / 2);
      row.addChild(tag);

      this.rowLayer.addChild(row);
    }

    this.highlight.y = (this.index - this.scrollTop) * ROW_H;

    // Overflow arrows.
    if (this.scrollTop > 0 || end < this.items.length) {
      const more = new Text({
        text: `${this.scrollTop > 0 ? '▲ ' : ''}${end < this.items.length ? '▼' : ''}`,
        style: { fill: '#5f5f7a', fontSize: 12 },
      });
      more.anchor.set(1, 0);
      more.position.set(this.width - 16, VISIBLE_ROWS * ROW_H + 2);
      this.rowLayer.addChild(more);
    }
  }
}
