/**
 * Chompo — the built-in default monster.
 *
 * Like the test song, Chompo ships as zero binary assets: the spritesheet
 * is drawn at runtime onto a canvas and the voice clips are synthesized
 * with an OfflineAudioContext. Everything then flows through the same
 * character.json contract mods use (parseCharacter → sliceSheet), so the
 * loader path is exercised end to end. A real art pass can replace this
 * with a PNG + JSON and nothing else changes.
 */

import { Texture } from 'pixi.js';
import {
  assertFramesInRange,
  parseCharacter,
  type CharacterDef,
} from '../../engine/character';
import { sliceSheet, type AtlasDef, type LoadedCharacter } from '../../engine/sheet';

const SOURCE = 'chompo (built-in)';
const FRAME = 128;
const COLS = 8;

// ---------------------------------------------------------------------------
// Poses — one per spritesheet frame, drawn parametrically.
// ---------------------------------------------------------------------------

type EyeStyle = 'open' | 'happy' | 'closed' | 'x' | 'spiral' | 'star';
type MouthStyle =
  | 'smile'
  | 'grin'
  | 'open'
  | 'wide'
  | 'full'
  | 'oh'
  | 'frown'
  | 'wavy';
type ArmStyle = 'down' | 'up';

interface Pose {
  /** Body squash/stretch; bottom stays anchored so bounces read as hops. */
  sx?: number;
  sy?: number;
  leanX?: number;
  leanY?: number;
  eyes?: EyeStyle;
  /** Baked pupil offset for 'open' eyes; omit to leave whites empty for the overlay. */
  pupilX?: number;
  pupilY?: number;
  mouth?: MouthStyle;
  mouthX?: number;
  mouthY?: number;
  arms?: ArmStyle;
  blush?: boolean;
  sweat?: boolean;
  tongue?: boolean;
  drip?: boolean;
  glow?: boolean;
  /** Sparkle layout variant: 0 = none. */
  sparkle?: 0 | 1 | 2;
}

interface AnimSpec {
  fps: number;
  loop?: boolean;
  poses: Pose[];
}

function chompPoses(dx: number, dy: number): Pose[] {
  return [
    {
      eyes: 'open',
      pupilX: dx * 3.5,
      pupilY: dy * 3.5,
      mouth: 'wide',
      mouthX: dx * 9,
      mouthY: dy * 7,
      leanX: dx * 4,
      leanY: dy * 3,
      sx: dx !== 0 ? 1.03 : 1,
      sy: dy < 0 ? 1.06 : dy > 0 ? 0.95 : 1.02,
    },
    {
      eyes: 'closed',
      mouth: 'full',
      mouthX: dx * 4,
      mouthY: dy * 3,
      leanX: dx * 2,
      leanY: dy * 1.5,
      sx: 1.06,
      sy: 0.95,
      blush: true,
    },
    { eyes: 'happy', mouth: 'smile', blush: true, sy: 1.01 },
  ];
}

const ANIMS: Record<string, AnimSpec> = {
  idle: {
    fps: 5,
    loop: true,
    poses: [
      { mouth: 'smile' },
      { mouth: 'smile', sy: 1.02, sx: 0.99, leanY: -1.5 },
      { mouth: 'smile' },
      { mouth: 'smile', sy: 0.985, sx: 1.01, leanY: 1 },
    ],
  },
  chomp_left: { fps: 20, poses: chompPoses(-1, 0) },
  chomp_right: { fps: 20, poses: chompPoses(1, 0) },
  chomp_up: { fps: 20, poses: chompPoses(0, -1) },
  chomp_down: { fps: 20, poses: chompPoses(0, 1) },
  perfect: {
    fps: 15,
    poses: [
      { eyes: 'star', mouth: 'grin', arms: 'up', sy: 1.07, sx: 0.96, sparkle: 1, blush: true },
      { eyes: 'star', mouth: 'grin', arms: 'up', sy: 0.95, sx: 1.05, sparkle: 2, blush: true },
      { eyes: 'star', mouth: 'grin', arms: 'up', sy: 1.05, sx: 0.97, sparkle: 1, blush: true },
      { eyes: 'happy', mouth: 'grin', arms: 'up', sparkle: 2, blush: true },
    ],
  },
  splat: {
    fps: 12,
    poses: [
      { eyes: 'x', mouth: 'oh', sweat: true, leanY: 1 },
      { eyes: 'x', mouth: 'wavy', tongue: true, drip: true, sweat: true, sy: 0.97 },
      { eyes: 'closed', mouth: 'frown', drip: true, sweat: true, sy: 0.98 },
    ],
  },
  combo_10: {
    fps: 6,
    loop: true,
    poses: [
      { eyes: 'happy', mouth: 'grin', blush: true, sy: 1.03, sx: 0.98 },
      { eyes: 'happy', mouth: 'grin', blush: true, sy: 0.97, sx: 1.02, arms: 'up' },
    ],
  },
  combo_25: {
    fps: 8,
    loop: true,
    poses: [
      { eyes: 'happy', mouth: 'grin', blush: true, arms: 'up', sy: 1.05, sx: 0.96, sparkle: 1 },
      { eyes: 'happy', mouth: 'grin', blush: true, arms: 'up', sy: 0.95, sx: 1.04, sparkle: 2 },
    ],
  },
  fever: {
    fps: 10,
    loop: true,
    poses: [
      { glow: true, eyes: 'star', mouth: 'grin', arms: 'up', sy: 1.06, sx: 0.96, sparkle: 1, blush: true },
      { glow: true, eyes: 'star', mouth: 'grin', arms: 'up', sparkle: 2, blush: true },
      { glow: true, eyes: 'star', mouth: 'grin', arms: 'up', sy: 0.94, sx: 1.05, sparkle: 1, blush: true },
      { glow: true, eyes: 'star', mouth: 'grin', arms: 'up', sparkle: 2, blush: true },
    ],
  },
  ko: {
    fps: 8,
    poses: [
      { eyes: 'spiral', mouth: 'oh', sweat: true, leanX: -3 },
      { eyes: 'spiral', mouth: 'oh', sweat: true, leanX: 3, sy: 0.97 },
      { eyes: 'spiral', mouth: 'frown', sweat: true, leanX: -2, sy: 0.9 },
      { eyes: 'x', mouth: 'frown', sweat: true, sy: 0.72, sx: 1.12 },
      { eyes: 'x', mouth: 'wavy', tongue: true, sweat: true, sy: 0.45, sx: 1.35 },
    ],
  },
};

// ---------------------------------------------------------------------------
// Character definition — assembled from ANIMS and fed through parseCharacter
// so the built-in character obeys the exact contract mods are held to.
// ---------------------------------------------------------------------------

function buildDef(): { def: CharacterDef; poses: Pose[] } {
  const poses: Pose[] = [];
  const animations: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(ANIMS)) {
    const frames = spec.poses.map((pose) => {
      poses.push(pose);
      return poses.length - 1;
    });
    animations[name] = { frames, fps: spec.fps, ...(spec.loop ? { loop: true } : {}) };
  }
  const json = {
    id: 'chompo',
    name: 'Chompo',
    spritesheet: 'generated:canvas',
    atlas: 'generated:grid',
    animations,
    eyes: {
      left: { x: 47, y: 62 },
      right: { x: 81, y: 62 },
      travel: 3.5,
      pupilRadius: 4,
      color: '#26183f',
      // Only idle leaves the eye whites empty for the runtime pupils;
      // every other animation bakes its own eye art.
      hiddenDuring: Object.keys(ANIMS).filter((n) => n !== 'idle'),
    },
    voice: {
      chomp: ['synth:chomp'],
      perfect: ['synth:yum'],
      splat: ['synth:bleh'],
      ko: ['synth:ko'],
      cheer: ['synth:cheer'],
    },
  };
  return { def: parseCharacter(json, SOURCE), poses };
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

const BODY = '#7a5cff';
const BODY_DARK = '#5b3fd6';
const BELLY = '#a695ff';
const FACE_DARK = '#26183f';
const MOUTH_BG = '#3a1f66';
const TONGUE = '#ff7bac';
const TEETH = '#ffffff';
const BLUSH = 'rgba(255, 120, 170, 0.5)';
const GOO = '#8bd94a';
const SWEAT = '#7fd4ff';
const SPARK = '#ffe98a';

const SPARKLE_SPOTS: Record<1 | 2, ReadonlyArray<[number, number, number]>> = {
  1: [
    [20, 26, 5],
    [106, 40, 4],
    [30, 96, 3.5],
  ],
  2: [
    [102, 22, 4.5],
    [16, 60, 3.5],
    [98, 96, 4],
  ],
};

function drawPose(g: CanvasRenderingContext2D, p: Pose): void {
  const sx = p.sx ?? 1;
  const sy = p.sy ?? 1;
  const rx = 42 * sx;
  const ry = 38 * sy;
  const cx = 64 + (p.leanX ?? 0);
  // Bottom-anchored so squash reads as pressing into the ground.
  const cy = 112 - ry + (p.leanY ?? 0);

  if (p.glow) {
    const grad = g.createRadialGradient(cx, cy - 4, 10, cx, cy - 4, 60);
    grad.addColorStop(0, 'rgba(255, 200, 80, 0.55)');
    grad.addColorStop(1, 'rgba(255, 200, 80, 0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy - 4, 60, 0, Math.PI * 2);
    g.fill();
  }

  // Feet
  g.fillStyle = BODY_DARK;
  for (const side of [-1, 1]) {
    g.beginPath();
    g.ellipse(cx + side * 18 * sx, 112, 10, 6, 0, 0, Math.PI * 2);
    g.fill();
  }

  // Arms
  const armY = p.arms === 'up' ? cy - ry * 0.55 : cy + ry * 0.15;
  const armTilt = p.arms === 'up' ? -0.9 : 0.5;
  g.fillStyle = BODY_DARK;
  for (const side of [-1, 1]) {
    g.beginPath();
    g.ellipse(cx + side * (rx - 2), armY, 6.5, 12, side * armTilt, 0, Math.PI * 2);
    g.fill();
  }

  // Horn nubs
  g.fillStyle = BODY_DARK;
  for (const side of [-1, 1]) {
    g.beginPath();
    g.ellipse(
      cx + side * rx * 0.48,
      cy - ry * 0.98,
      7,
      11,
      side * 0.35,
      0,
      Math.PI * 2,
    );
    g.fill();
  }

  // Body + belly
  g.fillStyle = BODY;
  g.beginPath();
  g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = BELLY;
  g.beginPath();
  g.ellipse(cx, cy + ry * 0.4, rx * 0.6, ry * 0.45, 0, 0, Math.PI * 2);
  g.fill();

  // Face
  const eyeY = cy - 12 * sy;
  for (const side of [-1, 1]) {
    drawEye(g, cx + side * 17 * sx, eyeY, p);
  }

  if (p.blush) {
    g.fillStyle = BLUSH;
    for (const side of [-1, 1]) {
      g.beginPath();
      g.ellipse(cx + side * 27 * sx, cy + 1, 7, 4, 0, 0, Math.PI * 2);
      g.fill();
    }
  }

  drawMouth(g, cx + (p.mouthX ?? 0), cy + 13 * sy + (p.mouthY ?? 0), p);

  // Extras
  if (p.drip) {
    g.fillStyle = GOO;
    g.beginPath();
    g.ellipse(cx, cy - ry + 5, rx * 0.7, 8, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(cx - 15, cy - ry + 16, 3.5, 7, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(cx + 11, cy - ry + 20, 3, 8, 0, 0, Math.PI * 2);
    g.fill();
  }
  if (p.sweat) {
    const swx = cx - rx * 0.8;
    const swy = cy - ry * 0.8;
    g.fillStyle = SWEAT;
    g.beginPath();
    g.moveTo(swx, swy - 8);
    g.quadraticCurveTo(swx + 6, swy + 2, swx, swy + 6);
    g.quadraticCurveTo(swx - 6, swy + 2, swx, swy - 8);
    g.fill();
  }
  if (p.sparkle) {
    g.fillStyle = SPARK;
    for (const [x, y, r] of SPARKLE_SPOTS[p.sparkle]) {
      drawSparkle(g, x, y, r);
    }
  }
}

function drawEye(g: CanvasRenderingContext2D, x: number, y: number, p: Pose): void {
  const style = p.eyes ?? 'open';
  g.strokeStyle = FACE_DARK;
  g.lineWidth = 3;
  g.lineCap = 'round';

  switch (style) {
    case 'open':
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.ellipse(x, y, 9.5, 10.5, 0, 0, Math.PI * 2);
      g.fill();
      if (p.pupilX !== undefined || p.pupilY !== undefined) {
        g.fillStyle = FACE_DARK;
        g.beginPath();
        g.arc(x + (p.pupilX ?? 0), y + (p.pupilY ?? 0), 4, 0, Math.PI * 2);
        g.fill();
      }
      break;
    case 'happy':
      g.beginPath();
      g.arc(x, y + 4, 7.5, Math.PI * 1.15, Math.PI * 1.85);
      g.stroke();
      break;
    case 'closed':
      g.beginPath();
      g.arc(x, y - 4, 7.5, Math.PI * 0.15, Math.PI * 0.85);
      g.stroke();
      break;
    case 'x':
      g.beginPath();
      g.moveTo(x - 5, y - 5);
      g.lineTo(x + 5, y + 5);
      g.moveTo(x + 5, y - 5);
      g.lineTo(x - 5, y + 5);
      g.stroke();
      break;
    case 'spiral':
      g.lineWidth = 2.5;
      g.beginPath();
      g.arc(x, y, 7, 0, Math.PI * 1.5);
      g.stroke();
      g.beginPath();
      g.arc(x, y - 1.5, 4, Math.PI * 1.5, Math.PI * 3);
      g.stroke();
      break;
    case 'star':
      g.fillStyle = SPARK;
      drawSparkle(g, x, y, 8);
      break;
  }
}

function drawMouth(g: CanvasRenderingContext2D, x: number, y: number, p: Pose): void {
  const style = p.mouth ?? 'smile';
  g.strokeStyle = MOUTH_BG;
  g.lineWidth = 3.5;
  g.lineCap = 'round';

  switch (style) {
    case 'smile':
      g.beginPath();
      g.arc(x, y - 4, 10, Math.PI * 0.2, Math.PI * 0.8);
      g.stroke();
      break;
    case 'grin':
      g.fillStyle = MOUTH_BG;
      g.beginPath();
      g.arc(x, y - 2, 13, 0, Math.PI);
      g.closePath();
      g.fill();
      g.fillStyle = TEETH;
      g.fillRect(x - 10, y - 2, 20, 3.5);
      break;
    case 'open':
      g.fillStyle = MOUTH_BG;
      g.beginPath();
      g.ellipse(x, y, 8, 10, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = TONGUE;
      g.beginPath();
      g.ellipse(x, y + 5, 5, 4, 0, 0, Math.PI * 2);
      g.fill();
      break;
    case 'wide':
      g.fillStyle = MOUTH_BG;
      g.beginPath();
      g.ellipse(x, y, 14, 16, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = TEETH;
      g.beginPath();
      g.moveTo(x - 11, y - 12);
      g.lineTo(x - 5, y - 4);
      g.lineTo(x - 1, y - 13);
      g.closePath();
      g.fill();
      g.beginPath();
      g.moveTo(x + 2, y - 13);
      g.lineTo(x + 7, y - 4);
      g.lineTo(x + 12, y - 11);
      g.closePath();
      g.fill();
      g.fillStyle = TONGUE;
      g.beginPath();
      g.ellipse(x, y + 9, 8, 5.5, 0, 0, Math.PI * 2);
      g.fill();
      break;
    case 'full':
      // Cheeks stuffed: pressed-tight wavy lips between bulging cheeks.
      g.fillStyle = BODY;
      for (const side of [-1, 1]) {
        g.beginPath();
        g.ellipse(x + side * 14, y - 2, 11, 10, 0, 0, Math.PI * 2);
        g.fill();
      }
      g.beginPath();
      g.moveTo(x - 8, y);
      g.quadraticCurveTo(x - 4, y - 4, x, y);
      g.quadraticCurveTo(x + 4, y + 4, x + 8, y);
      g.stroke();
      break;
    case 'oh':
      g.fillStyle = MOUTH_BG;
      g.beginPath();
      g.arc(x, y, 5.5, 0, Math.PI * 2);
      g.fill();
      break;
    case 'frown':
      g.beginPath();
      g.arc(x, y + 6, 9, Math.PI * 1.2, Math.PI * 1.8);
      g.stroke();
      break;
    case 'wavy':
      g.beginPath();
      g.moveTo(x - 10, y);
      g.quadraticCurveTo(x - 5, y - 5, x, y);
      g.quadraticCurveTo(x + 5, y + 5, x + 10, y);
      g.stroke();
      break;
  }

  if (p.tongue && style !== 'open' && style !== 'wide') {
    g.fillStyle = TONGUE;
    g.beginPath();
    g.ellipse(x, y + 8, 5, 8, 0, 0, Math.PI * 2);
    g.fill();
  }
}

function drawSparkle(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  const w = r * 0.36;
  g.beginPath();
  g.moveTo(x, y - r);
  g.quadraticCurveTo(x + w, y - w, x + r, y);
  g.quadraticCurveTo(x + w, y + w, x, y + r);
  g.quadraticCurveTo(x - w, y + w, x - r, y);
  g.quadraticCurveTo(x - w, y - w, x, y - r);
  g.fill();
}

function drawSheet(poses: readonly Pose[]): HTMLCanvasElement {
  const rows = Math.ceil(poses.length / COLS);
  const canvas = document.createElement('canvas');
  canvas.width = COLS * FRAME;
  canvas.height = rows * FRAME;
  const g = canvas.getContext('2d')!;
  poses.forEach((pose, i) => {
    g.save();
    g.translate((i % COLS) * FRAME, Math.floor(i / COLS) * FRAME);
    g.beginPath();
    g.rect(0, 0, FRAME, FRAME);
    g.clip();
    drawPose(g, pose);
    g.restore();
  });
  return canvas;
}

// ---------------------------------------------------------------------------
// Voice — tiny synthesized clips, quiet enough to sit under the music.
// ---------------------------------------------------------------------------

const VOICE_RATE = 22050;

async function renderClip(
  durationS: number,
  build: (ctx: OfflineAudioContext) => void,
): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(
    1,
    Math.ceil(durationS * VOICE_RATE),
    VOICE_RATE,
  );
  build(ctx);
  return ctx.startRendering();
}

interface ToneOpts {
  type: OscillatorType;
  from: number;
  to: number;
  t0: number;
  dur: number;
  gain: number;
}

function tone(ctx: OfflineAudioContext, o: ToneOpts): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = o.type;
  osc.frequency.setValueAtTime(o.from, o.t0);
  osc.frequency.exponentialRampToValueAtTime(o.to, o.t0 + o.dur);
  gain.gain.setValueAtTime(o.gain, o.t0);
  gain.gain.exponentialRampToValueAtTime(0.001, o.t0 + o.dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(o.t0);
  osc.stop(o.t0 + o.dur);
}

function noiseBurst(
  ctx: OfflineAudioContext,
  t0: number,
  dur: number,
  gainValue: number,
  highpassHz: number,
): void {
  const buffer = ctx.createBuffer(1, Math.ceil(dur * VOICE_RATE), VOICE_RATE);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = highpassHz;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(gainValue, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start(t0);
  src.stop(t0 + dur);
}

function chompClip(pitch: number): Promise<AudioBuffer> {
  return renderClip(0.12, (ctx) => {
    tone(ctx, { type: 'sine', from: 170 * pitch, to: 60 * pitch, t0: 0, dur: 0.09, gain: 0.3 });
    noiseBurst(ctx, 0, 0.04, 0.12, 2500);
  });
}

function yumClip(pitch: number): Promise<AudioBuffer> {
  return renderClip(0.25, (ctx) => {
    tone(ctx, { type: 'triangle', from: 480 * pitch, to: 720 * pitch, t0: 0, dur: 0.07, gain: 0.18 });
    tone(ctx, { type: 'triangle', from: 640 * pitch, to: 1040 * pitch, t0: 0.1, dur: 0.12, gain: 0.18 });
  });
}

function blehClip(): Promise<AudioBuffer> {
  return renderClip(0.32, (ctx) => {
    noiseBurst(ctx, 0, 0.05, 0.1, 800);
    tone(ctx, { type: 'sawtooth', from: 260, to: 200, t0: 0.02, dur: 0.09, gain: 0.13 });
    tone(ctx, { type: 'sawtooth', from: 230, to: 130, t0: 0.12, dur: 0.18, gain: 0.13 });
  });
}

function koClip(): Promise<AudioBuffer> {
  return renderClip(0.75, (ctx) => {
    tone(ctx, { type: 'triangle', from: 392, to: 380, t0: 0, dur: 0.15, gain: 0.15 });
    tone(ctx, { type: 'triangle', from: 330, to: 318, t0: 0.18, dur: 0.15, gain: 0.15 });
    tone(ctx, { type: 'triangle', from: 247, to: 165, t0: 0.36, dur: 0.36, gain: 0.15 });
  });
}

function cheerClip(): Promise<AudioBuffer> {
  return renderClip(0.42, (ctx) => {
    const steps = [523, 659, 784, 1047];
    steps.forEach((hz, i) => {
      tone(ctx, { type: 'square', from: hz, to: hz * 1.01, t0: i * 0.08, dur: 0.1, gain: 0.09 });
    });
  });
}

async function synthesizeVoice(): Promise<Map<string, AudioBuffer[]>> {
  const [chomps, yums, bleh, ko, cheer] = await Promise.all([
    Promise.all([chompClip(1), chompClip(1.15), chompClip(0.9)]),
    Promise.all([yumClip(1), yumClip(1.12)]),
    blehClip(),
    koClip(),
    cheerClip(),
  ]);
  return new Map([
    ['chomp', chomps],
    ['perfect', yums],
    ['splat', [bleh]],
    ['ko', [ko]],
    ['cheer', [cheer]],
  ]);
}

// ---------------------------------------------------------------------------

export async function buildChompo(): Promise<LoadedCharacter> {
  const { def, poses } = buildDef();
  const atlas: AtlasDef = { frameWidth: FRAME, frameHeight: FRAME };
  const canvas = drawSheet(poses);
  const textures = sliceSheet(Texture.from(canvas).source, atlas);
  assertFramesInRange(def, textures.length, SOURCE);
  const voice = await synthesizeVoice();
  return { def, textures, voice };
}
