/**
 * Built-in test song: a 128 BPM drum groove rendered offline to an
 * AudioBuffer. No audio assets to ship, fully deterministic, and it drives
 * the exact AudioBufferSourceNode playback path that real/modded songs use.
 */

export const TEST_TRACK_BPM = 128;
export const TEST_TRACK_BARS = 16;

const SAMPLE_RATE = 44100;

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

function makeNoiseBuffer(ctx: OfflineAudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, SAMPLE_RATE / 4, SAMPLE_RATE);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
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
