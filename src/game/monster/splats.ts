/**
 * SplatLayer — food splats that land on the monster's face and STAY there,
 * accumulating over the song. Funny fail states are shareable fail states.
 *
 * Splats are kept as plain specs (frame-local px) alongside the Pixi view,
 * so the share card can re-render the exact same mess at any scale. The
 * layer is attached inside the monster's scaled body via attachOverlay(),
 * which means splats ride the squash-and-stretch pulse and survive
 * combo-tier texture swaps for free.
 */

import { Container, Graphics } from 'pixi.js';

/** A single splat, in frame-local px (128-px character frame, origin centre). */
export interface SplatSpec {
  x: number;
  y: number;
  r: number;
  color: number;
  rot: number;
  bornMs: number;
}

const MAX_SPLATS = 14;
const POP_IN_MS = 120;
const SPLAT_ALPHA = 0.85;

/** Face ellipse the splats land in (frame-local px; tuned for 128-px frames). */
const FACE_CX = 0;
const FACE_CY = -2;
const FACE_RX = 30;
const FACE_RY = 22;

/** Gooey food tones — deliberately near the note FOOD_COLORS palette. */
const SPLAT_COLORS = [0xffd166, 0xff5c8a, 0x66d9ff, 0x9dff6b, 0xff9f43];

export class SplatLayer {
  readonly view = new Container();
  private readonly items: { spec: SplatSpec; g: Graphics }[] = [];

  add(nowMs: number, color?: number): SplatSpec {
    // Uniform-ish point in the face ellipse (rejection-free polar sample).
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random());
    const spec: SplatSpec = {
      x: FACE_CX + Math.cos(a) * FACE_RX * d,
      y: FACE_CY + Math.sin(a) * FACE_RY * d,
      r: 5 + Math.random() * 5,
      color:
        color ?? SPLAT_COLORS[Math.floor(Math.random() * SPLAT_COLORS.length)]!,
      rot: Math.random() * Math.PI * 2,
      bornMs: nowMs,
    };

    const g = new Graphics();
    SplatLayer.drawSpec(g, spec, 1);
    g.position.set(spec.x, spec.y);
    g.rotation = spec.rot;
    g.alpha = SPLAT_ALPHA;
    this.view.addChild(g);
    this.items.push({ spec, g });

    if (this.items.length > MAX_SPLATS) {
      const oldest = this.items.shift()!;
      oldest.g.destroy();
    }
    return spec;
  }

  /** Pop-in scale on fresh splats; older ones just sit there being funny. */
  update(nowMs: number): void {
    for (const { spec, g } of this.items) {
      const age = nowMs - spec.bornMs;
      const t = Math.min(1, Math.max(0, age / POP_IN_MS));
      // Overshoot then settle: 1.35 → 1.
      g.scale.set(1 + 0.35 * (1 - t));
    }
  }

  clear(): void {
    for (const { g } of this.items) g.destroy();
    this.items.length = 0;
    this.view.removeChildren();
  }

  get specs(): readonly SplatSpec[] {
    return this.items.map((i) => i.spec);
  }

  /**
   * Draw one splat blob at the given scale into a Graphics positioned at the
   * splat's centre. Shared with the share card so both render identically.
   */
  static drawSpec(g: Graphics, spec: SplatSpec, scale: number): void {
    const r = spec.r * scale;
    g.ellipse(0, 0, r, r * 0.8).fill(spec.color);
    // Satellite droplets, deterministic per splat via its rotation seed.
    const seeds = [spec.rot * 7.13, spec.rot * 3.71 + 2.1, spec.rot * 5.29 + 4.4];
    for (let i = 0; i < seeds.length; i++) {
      const s = seeds[i]!;
      const dx = Math.cos(s) * r * (1.1 + 0.4 * Math.abs(Math.sin(s * 2)));
      const dy = Math.sin(s) * r * (0.9 + 0.3 * Math.abs(Math.cos(s * 3)));
      const dr = r * (0.22 + 0.16 * Math.abs(Math.sin(s * 5)));
      g.circle(dx, dy, dr).fill(spec.color);
    }
  }
}
