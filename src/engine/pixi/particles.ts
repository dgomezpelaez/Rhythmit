/**
 * Particles — pooled, analytic bursts.
 *
 * Each particle's position and alpha are computed from its age every frame
 * (x = x0 + vx·t + ½g·t²); nothing integrates per frame, so particles obey
 * whatever clock the caller passes in — including a hitstop-clamped visual
 * clock — and stay deterministic. A fixed pool of sprites sharing one tiny
 * white-circle texture (tinted per particle) keeps spam-safe; when the pool
 * is full the oldest particle is recycled.
 */

import { Container, Sprite, Texture } from 'pixi.js';

const DEFAULT_MAX = 256;
const TEXTURE_RADIUS = 16;

export interface BurstOptions {
  x: number;
  y: number;
  count: number;
  colors: readonly number[];
  /** Initial speed range in px/s. */
  speed: [min: number, max: number];
  lifeMs: [min: number, max: number];
  /** Rendered radius range in px. */
  size: [min: number, max: number];
  /** px/s², positive is down. Default 0. */
  gravity?: number;
  /** Launch angle range in radians. Default: full circle. */
  angle?: [min: number, max: number];
}

interface Particle {
  sprite: Sprite;
  bornMs: number;
  lifeMs: number;
  x0: number;
  y0: number;
  vx: number;
  vy: number;
  gravity: number;
}

function circleTexture(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TEXTURE_RADIUS * 2;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(TEXTURE_RADIUS, TEXTURE_RADIUS, TEXTURE_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  return Texture.from(canvas);
}

function pick(range: [number, number]): number {
  return range[0] + Math.random() * (range[1] - range[0]);
}

export class ParticleSystem {
  readonly view = new Container();
  private readonly texture = circleTexture();
  private readonly live: Particle[] = [];
  private readonly free: Sprite[] = [];

  constructor(private readonly max = DEFAULT_MAX) {}

  burst(nowMs: number, opts: BurstOptions): void {
    const [minA, maxA] = opts.angle ?? [0, Math.PI * 2];
    for (let i = 0; i < opts.count; i++) {
      const sprite = this.takeSprite();
      const angle = minA + Math.random() * (maxA - minA);
      const speed = pick(opts.speed);
      const radius = pick(opts.size);
      sprite.tint = opts.colors[Math.floor(Math.random() * opts.colors.length)]!;
      sprite.width = sprite.height = radius * 2;
      sprite.visible = true;
      this.live.push({
        sprite,
        bornMs: nowMs,
        lifeMs: pick(opts.lifeMs),
        x0: opts.x,
        y0: opts.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        gravity: opts.gravity ?? 0,
      });
    }
  }

  update(nowMs: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i]!;
      const ageMs = nowMs - p.bornMs;
      if (ageMs >= p.lifeMs || ageMs < 0) {
        this.release(i);
        continue;
      }
      const t = ageMs / 1000;
      p.sprite.x = p.x0 + p.vx * t;
      p.sprite.y = p.y0 + p.vy * t + 0.5 * p.gravity * t * t;
      p.sprite.alpha = 1 - ageMs / p.lifeMs;
    }
  }

  clear(): void {
    for (let i = this.live.length - 1; i >= 0; i--) this.release(i);
  }

  private takeSprite(): Sprite {
    const pooled = this.free.pop();
    if (pooled) return pooled;
    if (this.live.length >= this.max) {
      // Recycle the oldest live particle.
      let oldest = 0;
      for (let i = 1; i < this.live.length; i++) {
        if (this.live[i]!.bornMs < this.live[oldest]!.bornMs) oldest = i;
      }
      const sprite = this.live[oldest]!.sprite;
      this.live.splice(oldest, 1);
      return sprite;
    }
    const sprite = new Sprite(this.texture);
    sprite.anchor.set(0.5);
    this.view.addChild(sprite);
    return sprite;
  }

  private release(index: number): void {
    const p = this.live[index]!;
    p.sprite.visible = false;
    this.free.push(p.sprite);
    this.live.splice(index, 1);
  }
}
