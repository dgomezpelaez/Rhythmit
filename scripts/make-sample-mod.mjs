/**
 * Generates examples/sample-mod/ — a complete, minimal Monster Feeder mod:
 * the "Blobby" character, the "Bounce" song, and the "Pepper" food.
 * Zero dependencies: PNGs are encoded by hand (RGBA → deflate → chunks)
 * and audio is written as PCM16 WAV. Re-run any time:
 *
 *   node scripts/make-sample-mod.mjs
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'sample-mod');

// ---------------------------------------------------------------------------
// PNG encoder (8-bit RGBA, filter 0 on every row)
// ---------------------------------------------------------------------------

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(bytes) {
  let c = -1;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** rgba: Uint8Array of length w*h*4 */
function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(
      raw,
      y * (1 + w * 4) + 1,
    );
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Tiny RGBA canvas
// ---------------------------------------------------------------------------

class Rgba {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h * 4);
  }
  set(x, y, [r, g, b, a = 255]) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = r;
    this.data[i + 1] = g;
    this.data[i + 2] = b;
    this.data[i + 3] = a;
  }
  ellipse(cx, cy, rx, ry, color) {
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
      for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, color);
      }
    }
  }
  rect(x0, y0, w, h, color) {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) this.set(x, y, color);
    }
  }
}

// ---------------------------------------------------------------------------
// Blobby — a round teal blob, 128px frames, 8 columns
// ---------------------------------------------------------------------------

const FRAME = 128;
const COLS = 8;

const TEAL = [64, 204, 190];
const TEAL_DARK = [36, 150, 140];
const WHITE = [255, 255, 255];
const DARK = [20, 50, 48];
const MOUTH = [30, 70, 66];
const TONGUE = [255, 130, 160];
const STAR = [255, 230, 120];
const GOO = [140, 220, 80];

/**
 * pose: { lean:[dx,dy], squash, eyes:'open'|'happy'|'x'|'star', pupil:[dx,dy],
 *         mouth:'smile'|'open'|'wide'|'frown', mouthShift:[dx,dy], goo, tongue }
 */
function drawBlobby(img, ox, oy, pose) {
  const squash = pose.squash ?? 1;
  const [lx, ly] = pose.lean ?? [0, 0];
  const rx = 44;
  const ry = Math.round(40 * squash);
  const cx = ox + 64 + lx;
  const cy = oy + 108 - ry + ly; // bottom-anchored

  // feet
  img.ellipse(cx - 20, oy + 110, 11, 6, TEAL_DARK);
  img.ellipse(cx + 20, oy + 110, 11, 6, TEAL_DARK);
  // body
  img.ellipse(cx, cy, rx, ry, TEAL);
  img.ellipse(cx, cy + Math.round(ry * 0.45), Math.round(rx * 0.55), Math.round(ry * 0.4), [
    150, 230, 220,
  ]);

  // eyes
  const eyeY = cy - Math.round(10 * squash);
  for (const side of [-1, 1]) {
    const ex = cx + side * 17;
    const style = pose.eyes ?? 'open';
    if (style === 'open') {
      img.ellipse(ex, eyeY, 9, 10, WHITE);
      const [px, py] = pose.pupil ?? [0, 0];
      img.ellipse(ex + px, eyeY + py, 4, 4, DARK);
    } else if (style === 'happy') {
      img.rect(ex - 7, eyeY - 1, 14, 3, DARK);
      img.rect(ex - 7, eyeY - 4, 3, 4, DARK);
      img.rect(ex + 4, eyeY - 4, 3, 4, DARK);
    } else if (style === 'x') {
      for (let d = -5; d <= 5; d++) {
        img.rect(ex + d - 1, eyeY + d - 1, 2, 2, DARK);
        img.rect(ex + d - 1, eyeY - d - 1, 2, 2, DARK);
      }
    } else if (style === 'star') {
      img.ellipse(ex, eyeY, 7, 7, STAR);
      img.rect(ex - 1, eyeY - 10, 2, 20, STAR);
      img.rect(ex - 10, eyeY - 1, 20, 2, STAR);
    }
  }

  // mouth
  const [mx, my] = pose.mouthShift ?? [0, 0];
  const mouthX = cx + mx;
  const mouthY = cy + Math.round(14 * squash) + my;
  const mouth = pose.mouth ?? 'smile';
  if (mouth === 'smile') {
    img.rect(mouthX - 9, mouthY, 18, 3, MOUTH);
    img.rect(mouthX - 12, mouthY - 3, 3, 4, MOUTH);
    img.rect(mouthX + 9, mouthY - 3, 3, 4, MOUTH);
  } else if (mouth === 'open') {
    img.ellipse(mouthX, mouthY, 8, 9, MOUTH);
    img.ellipse(mouthX, mouthY + 4, 5, 4, TONGUE);
  } else if (mouth === 'wide') {
    img.ellipse(mouthX, mouthY, 14, 15, MOUTH);
    img.ellipse(mouthX, mouthY + 8, 8, 5, TONGUE);
  } else if (mouth === 'frown') {
    img.rect(mouthX - 9, mouthY, 18, 3, MOUTH);
    img.rect(mouthX - 12, mouthY + 1, 3, 4, MOUTH);
    img.rect(mouthX + 9, mouthY + 1, 3, 4, MOUTH);
  }

  if (pose.goo) img.ellipse(cx, cy - ry + 4, Math.round(rx * 0.6), 7, GOO);
  if (pose.tongue) img.ellipse(mouthX, mouthY + 10, 5, 7, TONGUE);
}

function chomp(dx, dy) {
  return [
    { eyes: 'open', pupil: [dx * 3, dy * 3], mouth: 'wide', mouthShift: [dx * 8, dy * 6], lean: [dx * 4, dy * 2], squash: dy < 0 ? 1.06 : 0.98 },
    { eyes: 'happy', mouth: 'smile', squash: 1.03 },
  ];
}

const BLOBBY_ANIMS = {
  idle: { fps: 4, loop: true, poses: [
    { mouth: 'smile' },
    { mouth: 'smile', squash: 1.04 },
    { mouth: 'smile' },
    { mouth: 'smile', squash: 0.97 },
  ] },
  chomp_left: { fps: 14, poses: chomp(-1, 0) },
  chomp_right: { fps: 14, poses: chomp(1, 0) },
  chomp_up: { fps: 14, poses: chomp(0, -1) },
  chomp_down: { fps: 14, poses: chomp(0, 1) },
  perfect: { fps: 10, poses: [
    { eyes: 'star', mouth: 'wide', squash: 1.08 },
    { eyes: 'star', mouth: 'smile', squash: 0.95 },
    { eyes: 'happy', mouth: 'smile', squash: 1.02 },
  ] },
  splat: { fps: 10, poses: [
    { eyes: 'x', mouth: 'frown', goo: true, squash: 0.96 },
    { eyes: 'x', mouth: 'frown', goo: true, tongue: true, squash: 0.92 },
  ] },
  ko: { fps: 8, poses: [
    { eyes: 'x', mouth: 'frown', lean: [-3, 0] },
    { eyes: 'x', mouth: 'frown', lean: [3, 0], squash: 0.9 },
    { eyes: 'x', mouth: 'frown', tongue: true, squash: 0.6 },
    { eyes: 'x', mouth: 'frown', tongue: true, squash: 0.4 },
  ] },
  fever: { fps: 8, loop: true, poses: [
    { eyes: 'star', mouth: 'wide', squash: 1.07 },
    { eyes: 'star', mouth: 'wide', squash: 0.94 },
  ] },
};

function buildBlobby() {
  const poses = [];
  const animations = {};
  for (const [name, spec] of Object.entries(BLOBBY_ANIMS)) {
    animations[name] = {
      frames: spec.poses.map((pose) => {
        poses.push(pose);
        return poses.length - 1;
      }),
      fps: spec.fps,
      ...(spec.loop ? { loop: true } : {}),
    };
  }
  const rows = Math.ceil(poses.length / COLS);
  const img = new Rgba(COLS * FRAME, rows * FRAME);
  poses.forEach((pose, i) => {
    drawBlobby(img, (i % COLS) * FRAME, Math.floor(i / COLS) * FRAME, pose);
  });
  return {
    png: encodePng(img.w, img.h, img.data),
    json: {
      id: 'blobby',
      name: 'Blobby',
      spritesheet: 'sheet.png',
      atlas: 'atlas.json',
      animations,
      voice: {
        chomp: ['voice/chomp.wav'],
        perfect: ['voice/yum.wav'],
        splat: ['voice/bleh.wav'],
        ko: ['voice/ko.wav'],
        cheer: ['voice/cheer.wav'],
      },
    },
  };
}

// ---------------------------------------------------------------------------
// WAV writer (PCM16 mono) + synths
// ---------------------------------------------------------------------------

function wav(samples, rate) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8, 'ascii');
  header.writeUInt32LE(16, 16); // fmt size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** Add an exponential-decay tone (sine/square) into `out`. */
function tone(out, rate, t0, dur, from, to, gain, shape = 'sine') {
  const start = Math.floor(t0 * rate);
  const n = Math.floor(dur * rate);
  let phase = 0;
  for (let i = 0; i < n && start + i < out.length; i++) {
    const t = i / n;
    const hz = from * Math.pow(to / from, t);
    phase += (2 * Math.PI * hz) / rate;
    const s = Math.sin(phase);
    const v = shape === 'square' ? Math.sign(s) * 0.6 : s;
    out[start + i] += v * gain * Math.exp(-3 * t);
  }
}

function noise(out, rate, t0, dur, gain) {
  const start = Math.floor(t0 * rate);
  const n = Math.floor(dur * rate);
  for (let i = 0; i < n && start + i < out.length; i++) {
    out[start + i] += (Math.random() * 2 - 1) * gain * Math.exp(-8 * (i / n));
  }
}

const VOICE_RATE = 22050;

function voiceClip(dur, build) {
  const out = new Float64Array(Math.ceil(dur * VOICE_RATE));
  build(out);
  return wav(out, VOICE_RATE);
}

// ---------------------------------------------------------------------------
// Bounce — 120 BPM, 20 s chiptune loop at 16 kHz
// ---------------------------------------------------------------------------

const SONG_RATE = 16000;
const BPM = 120;
const BEAT_S = 60 / BPM; // 0.5 s
const SONG_LEN_S = 20;

// Simple I–VI–IV–V bassline, one chord per bar (4 beats).
const BASS_HZ = [110, 92.5, 87.31, 98]; // A2, F#2, F2, G2
const LEAD_HZ = [440, 494, 523, 587, 659, 587, 523, 494]; // A4 B4 C5 D5 E5 ...

function buildSong() {
  const out = new Float64Array(SONG_RATE * SONG_LEN_S);
  const beats = Math.floor(SONG_LEN_S / BEAT_S); // 40
  for (let beat = 0; beat < beats; beat++) {
    const t = beat * BEAT_S;
    const bar = Math.floor(beat / 4) % BASS_HZ.length;
    // kick + bass on every beat
    tone(out, SONG_RATE, t, 0.12, 150, 50, 0.5);
    tone(out, SONG_RATE, t, 0.4, BASS_HZ[bar], BASS_HZ[bar], 0.22, 'square');
    // hat on the off-beat
    noise(out, SONG_RATE, t + BEAT_S / 2, 0.05, 0.12);
    // lead every other beat, skipping the intro bar
    if (beat >= 4 && beat % 2 === 0) {
      const hz = LEAD_HZ[(beat / 2) % LEAD_HZ.length];
      tone(out, SONG_RATE, t, 0.3, hz, hz * 1.005, 0.15, 'square');
    }
  }
  return wav(out, SONG_RATE);
}

function buildChart() {
  const dirs = ['down', 'left', 'up', 'right'];
  const notes = [];
  const beats = Math.floor(SONG_LEN_S / BEAT_S);
  // Notes from bar 2 to one bar before the end; every beat, pepper on downbeats.
  for (let beat = 4; beat < beats - 4; beat++) {
    const timeMs = Math.round(beat * BEAT_S * 1000);
    const note = { timeMs, dir: dirs[beat % 4] };
    if (beat % 4 === 0) note.food = 'pepper';
    notes.push(note);
    // A little half-beat syncopation in the back half.
    if (beat >= 20 && beat % 4 === 2) {
      notes.push({ timeMs: timeMs + Math.round((BEAT_S / 2) * 1000), dir: dirs[(beat + 2) % 4] });
    }
  }
  return {
    version: 1,
    song: {
      title: 'Bounce',
      artist: 'Sample Mod',
      audio: 'bounce.wav',
      bpm: BPM,
      offsetMs: 0,
    },
    difficulty: 'normal',
    foods: { down: 'pepper' },
    notes,
  };
}

// ---------------------------------------------------------------------------
// Pepper — a 40x40 chili
// ---------------------------------------------------------------------------

function buildPepper() {
  const img = new Rgba(40, 40);
  img.ellipse(20, 24, 13, 11, [255, 68, 34]);
  img.ellipse(16, 21, 5, 4, [255, 140, 110]); // highlight
  img.rect(19, 6, 3, 8, [70, 160, 60]); // stem
  img.ellipse(20, 8, 6, 3, [90, 190, 70]); // leaf
  return encodePng(40, 40, img.data);
}

// ---------------------------------------------------------------------------
// Write everything
// ---------------------------------------------------------------------------

function write(rel, content) {
  const path = join(ROOT, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    typeof content === 'string' || Buffer.isBuffer(content)
      ? content
      : JSON.stringify(content, null, 2) + '\n',
  );
  console.log(`wrote ${rel}`);
}

const blobby = buildBlobby();
write('mod.json', {
  version: 1,
  id: 'sample-mod',
  name: 'Sample Mod',
  author: 'Monster Feeder',
  songs: ['songs/bounce/chart.json'],
  characters: ['characters/blobby/character.json'],
  foods: ['foods/foods.json'],
});
write('characters/blobby/character.json', blobby.json);
write('characters/blobby/atlas.json', { frameWidth: FRAME, frameHeight: FRAME });
write('characters/blobby/sheet.png', blobby.png);
write(
  'characters/blobby/voice/chomp.wav',
  voiceClip(0.12, (o) => {
    tone(o, VOICE_RATE, 0, 0.1, 220, 70, 0.3);
    noise(o, VOICE_RATE, 0, 0.04, 0.1);
  }),
);
write(
  'characters/blobby/voice/yum.wav',
  voiceClip(0.25, (o) => {
    tone(o, VOICE_RATE, 0, 0.08, 520, 780, 0.2);
    tone(o, VOICE_RATE, 0.1, 0.12, 700, 1100, 0.2);
  }),
);
write(
  'characters/blobby/voice/bleh.wav',
  voiceClip(0.3, (o) => {
    noise(o, VOICE_RATE, 0, 0.05, 0.1);
    tone(o, VOICE_RATE, 0.02, 0.25, 240, 120, 0.18, 'square');
  }),
);
write(
  'characters/blobby/voice/ko.wav',
  voiceClip(0.7, (o) => {
    tone(o, VOICE_RATE, 0, 0.18, 392, 370, 0.16);
    tone(o, VOICE_RATE, 0.2, 0.18, 330, 310, 0.16);
    tone(o, VOICE_RATE, 0.4, 0.3, 250, 150, 0.16);
  }),
);
write(
  'characters/blobby/voice/cheer.wav',
  voiceClip(0.45, (o) => {
    [523, 659, 784, 1047].forEach((hz, i) => {
      tone(o, VOICE_RATE, i * 0.09, 0.12, hz, hz * 1.01, 0.12, 'square');
    });
  }),
);
write('songs/bounce/chart.json', buildChart());
write('songs/bounce/bounce.wav', buildSong());
write('foods/foods.json', {
  version: 1,
  foods: [{ id: 'pepper', name: 'Pepper', color: '#ff4422', image: 'pepper.png' }],
});
write('foods/pepper.png', buildPepper());
console.log('sample mod complete');
