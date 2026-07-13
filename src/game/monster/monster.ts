/**
 * Monster — the character on stage and its reaction system.
 *
 * Two animation layers:
 *  - a looping BASE picked from the current combo (idle → combo_10 →
 *    combo_25 → fever), so streaks visibly transform the monster;
 *  - a ONE-SHOT that overrides the base (directional chomps, splat, the
 *    perfect flourish chained after a perfect chomp, and the terminal KO
 *    which holds its last frame).
 *
 * All animation timing comes from the song-time ms passed into update();
 * nothing accumulates per frame. On top of the frames there's a decaying
 * squash-and-stretch pulse on hits, and — when the character defines eye
 * positions — overlay pupils that track the nearest incoming food.
 */

import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import {
  animationDurationMs,
  frameAt,
  REQUIRED_ANIMATIONS,
  type EyesDef,
  type FrameAnimation,
} from '../../core/character';
import type { Direction } from '../../core/chart';
import type { Judgment } from '../../core/judge';
import type { LoadedCharacter } from '../../core/sheet';

const CHOMP_ANIM: Record<Direction, string> = {
  left: 'chomp_left',
  right: 'chomp_right',
  up: 'chomp_up',
  down: 'chomp_down',
};

/** Escalation tiers, highest first; missing optional anims fall through. */
const COMBO_TIERS: ReadonlyArray<{ min: number; anim: string }> = [
  { min: 50, anim: 'fever' },
  { min: 25, anim: 'combo_25' },
  { min: 10, anim: 'combo_10' },
];

const GAZE_SMOOTH_MS = 70;
const PULSE_DECAY_MS = 110;

export class Monster {
  readonly view = new Container();
  private readonly body = new Container();
  private readonly sprite: Sprite;
  private readonly pupils: Graphics | null = null;
  private readonly eyes: EyesDef | undefined;
  private readonly anims: Readonly<Record<string, FrameAnimation>>;

  private combo = 0;
  private celebrating = false;
  private koDown = false;
  private oneShot: { name: string; startMs: number } | null = null;
  private followUp: string | null = null;
  private pulse = 0;
  private gazeX = 0;
  private gazeY = 0;
  private nowMs = 0;
  private lastMs: number | null = null;

  constructor(
    private readonly character: LoadedCharacter,
    private readonly audio: AudioContext,
    private readonly displayScale = 1.3,
  ) {
    this.anims = character.def.animations;
    for (const name of REQUIRED_ANIMATIONS) {
      if (!this.anims[name]) {
        throw new Error(
          `character "${character.def.id}": required animation "${name}" missing`,
        );
      }
    }

    this.sprite = new Sprite(
      character.textures[this.anims['idle']!.frames[0]!]!,
    );
    this.sprite.anchor.set(0.5);
    this.body.addChild(this.sprite);

    this.eyes = character.def.eyes;
    if (this.eyes) {
      const w = this.sprite.texture.width;
      const h = this.sprite.texture.height;
      this.pupils = new Graphics()
        .circle(this.eyes.left.x - w / 2, this.eyes.left.y - h / 2, this.eyes.pupilRadius)
        .fill(this.eyes.color)
        .circle(this.eyes.right.x - w / 2, this.eyes.right.y - h / 2, this.eyes.pupilRadius)
        .fill(this.eyes.color);
      this.body.addChild(this.pupils);
    }

    this.body.scale.set(displayScale);
    this.view.addChild(this.body);
  }

  get name(): string {
    return this.character.def.name;
  }

  /**
   * Mount an overlay (e.g. splat decals) inside the scaled body, above the
   * sprite and pupils — it rides the squash-and-stretch pulse and survives
   * animation texture swaps. The child's coordinates are frame-local px.
   */
  attachOverlay(child: Container): void {
    this.body.addChild(child);
  }

  /** The texture currently on screen — lets the share card show the exact final state. */
  get currentTexture(): Texture {
    return this.sprite.texture;
  }

  reset(): void {
    this.combo = 0;
    this.celebrating = false;
    this.koDown = false;
    this.oneShot = null;
    this.followUp = null;
    this.pulse = 0;
    this.lastMs = null;
  }

  onHit(judgment: Exclude<Judgment, 'miss'>, dir: Direction): void {
    if (this.koDown) return;
    this.oneShot = { name: CHOMP_ANIM[dir], startMs: this.nowMs };
    this.followUp = judgment === 'perfect' ? 'perfect' : null;
    this.pulse = 1;
    this.say(judgment === 'perfect' ? 'perfect' : 'chomp');
  }

  onMiss(): void {
    if (this.koDown) return;
    this.oneShot = { name: 'splat', startMs: this.nowMs };
    this.followUp = null;
    this.say('splat');
  }

  setCombo(combo: number): void {
    if (this.koDown) return;
    const prev = this.tierOf(this.combo);
    this.combo = combo;
    const now = this.tierOf(combo);
    // Smaller index = higher tier; flourish when climbing into a new one.
    if (now !== null && (prev === null || now < prev)) {
      this.pulse = Math.max(this.pulse, 1);
      if (now === 0) this.say('cheer');
    }
  }

  /** Dejected collapse; the monster stays down until reset(). */
  knockOut(): void {
    if (this.koDown) return;
    this.koDown = true;
    this.oneShot = { name: 'ko', startMs: this.nowMs };
    this.followUp = null;
    this.say('ko');
  }

  /** Song-cleared celebration: flourish, then party loop as the base. */
  celebrate(): void {
    if (this.koDown) return;
    this.celebrating = true;
    this.oneShot = { name: 'perfect', startMs: this.nowMs };
    this.followUp = null;
    this.say('cheer');
  }

  /**
   * @param gazeTarget vector from the monster's centre to the nearest
   *   incoming food, in stage px — or null when nothing is inbound.
   */
  update(songMs: number, gazeTarget: { x: number; y: number } | null): void {
    const dt = this.lastMs === null ? 16 : Math.max(0, songMs - this.lastMs);
    this.lastMs = songMs;
    this.nowMs = songMs;

    // Expire the one-shot (KO never expires; frameAt clamps its last frame).
    if (this.oneShot && this.oneShot.name !== 'ko') {
      const anim = this.anims[this.oneShot.name]!;
      const endMs = this.oneShot.startMs + animationDurationMs(anim);
      if (!anim.loop && songMs >= endMs) {
        this.oneShot =
          this.followUp !== null
            ? { name: this.followUp, startMs: endMs }
            : null;
        this.followUp = null;
      }
    }

    const name = this.oneShot?.name ?? this.baseAnim();
    const anim = this.anims[name]!;
    const elapsed = this.oneShot ? songMs - this.oneShot.startMs : songMs;
    this.sprite.texture = this.character.textures[frameAt(anim, elapsed)]!;

    // Hit punch: quick squash-and-stretch on top of the baked frames.
    this.pulse *= Math.exp(-dt / PULSE_DECAY_MS);
    this.body.scale.set(
      this.displayScale * (1 + this.pulse * 0.07),
      this.displayScale * (1 - this.pulse * 0.05),
    );

    if (this.pupils && this.eyes) {
      const hidden = this.eyes.hiddenDuring.includes(name);
      this.pupils.visible = !hidden;
      if (!hidden) {
        let tx: number;
        let ty: number;
        if (gazeTarget) {
          const len = Math.hypot(gazeTarget.x, gazeTarget.y) || 1;
          tx = (gazeTarget.x / len) * this.eyes.travel;
          ty = (gazeTarget.y / len) * this.eyes.travel;
        } else {
          // Idle wander so the eyes never feel dead.
          tx = Math.cos(songMs * 0.0013) * this.eyes.travel * 0.4;
          ty = Math.sin(songMs * 0.0009) * this.eyes.travel * 0.3;
        }
        const k = 1 - Math.exp(-dt / GAZE_SMOOTH_MS);
        this.gazeX += (tx - this.gazeX) * k;
        this.gazeY += (ty - this.gazeY) * k;
        this.pupils.position.set(this.gazeX, this.gazeY);
      }
    }
  }

  /** Tier index for a combo (0 = highest), or null below every tier. */
  private tierOf(combo: number): number | null {
    for (let i = 0; i < COMBO_TIERS.length; i++) {
      if (combo >= COMBO_TIERS[i]!.min) return i;
    }
    return null;
  }

  private baseAnim(): string {
    const combo = this.celebrating ? Infinity : this.combo;
    for (const tier of COMBO_TIERS) {
      if (combo >= tier.min && this.anims[tier.anim]) return tier.anim;
    }
    return 'idle';
  }

  private say(kind: string): void {
    const clips = this.character.voice.get(kind);
    if (!clips || clips.length === 0) return;
    const src = this.audio.createBufferSource();
    src.buffer = clips[Math.floor(Math.random() * clips.length)]!;
    src.connect(this.audio.destination);
    src.start();
  }
}
