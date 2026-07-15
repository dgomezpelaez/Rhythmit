/**
 * Built-in test song: a 128 BPM drum groove rendered offline to an
 * AudioBuffer. No audio assets to ship, fully deterministic, and it drives
 * the exact AudioBufferSourceNode playback path that real/modded songs use.
 */

import { parseChart, type Chart, type Direction } from '../engine';

export const TEST_TRACK_BPM = 128;
export const TEST_TRACK_BARS = 16;

const SAMPLE_RATE = 44100;

/**
 * A gentle on-ramp variant of the built-in chart: one note per beat
 * (quarter notes only), rotating directions, same synthesized track.
 */
export function buildEasyTestChart(base: Chart): Chart {
  const beatMs = 60000 / TEST_TRACK_BPM;
  const dirs: readonly Direction[] = ['down', 'left', 'up', 'right'];
  const firstBeat = 8; // matches the main chart's first note (bar 3)
  const lastBeat = TEST_TRACK_BARS * 4 - 2; // leave the final bar to breathe
  const notes = [];
  for (let beat = firstBeat; beat <= lastBeat; beat++) {
    notes.push({
      timeMs: Math.round(beat * beatMs),
      dir: dirs[(beat - firstBeat) % dirs.length]!,
      type: 'tap' as const,
    });
  }
  return parseChart({
    version: 1,
    song: { ...base.song, title: `${base.song.title} (easy)` },
    difficulty: 'easy',
    notes,
  });
}

export async function synthesizeTestTrack(): Promise<AudioBuffer> {
  const beatS = 60 / TEST_TRACK_BPM;
  const durationS = TEST_TRACK_BARS * 4 * beatS + 0.5;
  const ctx = new OfflineAudioContext(
    1,
    Math.ceil(durationS * SAMPLE_RATE),
    SAMPLE_RATE,
  );

  const noise = makeNoiseBuffer(ctx);
  const totalBeats = TEST_TRACK_BARS * 4;

  for (let beat = 0; beat < totalBeats; beat++) {
    const t = beat * beatS;
    kick(ctx, t);
    if (beat % 4 === 1 || beat % 4 === 3) snare(ctx, noise, t);
    hat(ctx, noise, t);
    hat(ctx, noise, t + beatS / 2);
    bass(ctx, t, beat);
  }

  return ctx.startRendering();
}

/**
 * Encode channel 0 as a 16-bit PCM WAV — lets the test track flow through
 * the real file-import path (auto-chart self-test).
 */
export function encodeWavMono(buffer: AudioBuffer): ArrayBuffer {
  const data = buffer.getChannelData(0);
  const out = new ArrayBuffer(44 + data.length * 2);
  const view = new DataView(out);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + data.length * 2, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, 'data');
  view.setUint32(40, data.length * 2, true);
  for (let i = 0; i < data.length; i++) {
    const s = Math.max(-1, Math.min(1, data[i]!));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

function makeNoiseBuffer(ctx: OfflineAudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, SAMPLE_RATE / 4, SAMPLE_RATE);
  const data = buffer.getChannelData(0);
  // Seeded LCG, not Math.random(): the rendered bytes must be identical on
  // every run so the auto-chart cache (keyed by content hash) can be tested.
  let seed = 0x9e3779b9;
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 0xffffffff) * 2 - 1;
  }
  return buffer;
}

function kick(ctx: OfflineAudioContext, t: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, t);
  osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
  gain.gain.setValueAtTime(0.9, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.2);
}

function snare(ctx: OfflineAudioContext, noise: AudioBuffer, t: number): void {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 1500;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.35, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start(t);
  src.stop(t + 0.15);
}

function hat(ctx: OfflineAudioContext, noise: AudioBuffer, t: number): void {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 6500;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.1, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start(t);
  src.stop(t + 0.06);
}

/** Simple square bassline: A A C G, one root per bar, pulsed on quarters. */
const BASS_ROOTS = [55, 55, 65.41, 49];

function bass(ctx: OfflineAudioContext, t: number, beat: number): void {
  const bar = Math.floor(beat / 4);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = BASS_ROOTS[bar % BASS_ROOTS.length]!;
  gain.gain.setValueAtTime(0.1, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.32);
}
