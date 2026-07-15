/**
 * Share card — a 1200×630 (OG-image sized) PNG of the run: the monster's
 * actual final state (glorious or food-covered), grade, and stats.
 *
 * The card is a plain Pixi container composed off-stage from the monster's
 * *current texture* plus the accumulated splat specs, then rasterized with
 * renderer.extract. That keeps it working for any modded character
 * (spritesheet + JSON, zero code) — no chompo-specific drawing here.
 */

import { Container, Graphics, Sprite, Text, type Renderer, type Texture } from 'pixi.js';
import type { Grade } from '../engine';
import { SplatLayer, type SplatSpec } from './monster/splats';

export const CARD_W = 1200;
export const CARD_H = 630;

/** Matches the on-screen splat look. */
const SPLAT_ALPHA = 0.85;
const MONSTER_SCALE = 3.5;

const GRADE_COLORS: Record<Grade, number> = {
  S: 0xffd700,
  A: 0x7cff6b,
  B: 0xffd166,
  C: 0x9a9ab0,
};

export interface ShareCardInput {
  grade: Grade;
  score: number;
  accuracyPct: number;
  maxCombo: number;
  songTitle: string;
  monsterName: string;
  headline: string;
  monsterTexture: Texture;
  splats: readonly SplatSpec[];
}

export function buildShareCard(input: ShareCardInput): Container {
  const card = new Container();

  card.addChild(
    new Graphics()
      .rect(0, 0, CARD_W, CARD_H)
      .fill('#1a1a24')
      .rect(0, CARD_H - 14, CARD_W, 14)
      .fill(GRADE_COLORS[input.grade]),
  );

  // Right side: the monster exactly as the song left it, splats and all.
  const mx = CARD_W - 310;
  const my = CARD_H / 2 + 20;
  const monster = new Sprite(input.monsterTexture);
  monster.anchor.set(0.5);
  monster.scale.set(MONSTER_SCALE);
  monster.position.set(mx, my);
  card.addChild(monster);

  const splatLayer = new Container();
  splatLayer.position.set(mx, my);
  splatLayer.scale.set(MONSTER_SCALE);
  for (const spec of input.splats) {
    const g = new Graphics();
    SplatLayer.drawSpec(g, spec, 1);
    g.position.set(spec.x, spec.y);
    g.rotation = spec.rot;
    g.alpha = SPLAT_ALPHA;
    splatLayer.addChild(g);
  }
  card.addChild(splatLayer);

  // Left side: title, headline, big grade, stats.
  const addText = (
    text: string,
    x: number,
    y: number,
    fontSize: number,
    fill: string | number,
    bold = false,
  ) => {
    const t = new Text({
      text,
      style: {
        fill,
        fontSize,
        fontWeight: bold ? 'bold' : 'normal',
        fontFamily: 'system-ui, sans-serif',
      },
    });
    t.position.set(x, y);
    card.addChild(t);
    return t;
  };

  const nameTag = new Text({
    text: input.monsterName,
    style: {
      fill: '#9a9ab0',
      fontSize: 28,
      fontWeight: 'bold',
      fontFamily: 'system-ui, sans-serif',
    },
  });
  nameTag.anchor.set(0.5, 0);
  nameTag.position.set(mx, my + 240);
  card.addChild(nameTag);

  const left = 80;
  addText('MONSTER FEEDER', left, 70, 30, '#9a9ab0', true);
  addText(input.songTitle, left, 116, 40, '#ffffff', true);
  addText(input.headline, left, 176, 26, '#c8c8dc');

  const grade = addText(input.grade, left, 230, 200, GRADE_COLORS[input.grade], true);
  addText(
    `score  ${input.score}`,
    left + grade.width + 60,
    290,
    36,
    '#ffffff',
    true,
  );
  addText(
    `accuracy  ${input.accuracyPct.toFixed(1)}%`,
    left + grade.width + 60,
    345,
    28,
    '#c8c8dc',
  );
  addText(
    `max combo  ${input.maxCombo}`,
    left + grade.width + 60,
    388,
    28,
    '#c8c8dc',
  );

  return card;
}

export async function cardToBlob(
  renderer: Renderer,
  card: Container,
): Promise<Blob> {
  const canvas = renderer.extract.canvas(card) as HTMLCanvasElement;
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error('share card export failed')),
      'image/png',
    );
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // Give the click a tick to start before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const clipboardImageSupported =
  typeof ClipboardItem !== 'undefined' &&
  typeof navigator !== 'undefined' &&
  !!navigator.clipboard?.write;

/**
 * Copy a PNG to the clipboard. The *promise* is handed to ClipboardItem
 * synchronously — required so Safari still sees the user gesture.
 */
export async function copyImageToClipboard(
  blobPromise: Promise<Blob>,
): Promise<boolean> {
  if (!clipboardImageSupported) return false;
  try {
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': blobPromise }),
    ]);
    return true;
  } catch {
    return false;
  }
}
