import { Container, Graphics, Sprite, Text, type Renderer } from 'pixi.js';
import type { Chart, Direction, Note } from '../../engine/chart';
import type { Conductor } from '../../engine/conductor';
import { Hitstop } from '../../engine/hitstop';
import { HitJudge, WINDOWS, type Judgment } from '../../engine/judge';
import { ParticleSystem } from '../../engine/pixi/particles';
import { gradeFor, ScoreState } from '../../engine/score';
import { loadCalibrationOffsetMs } from '../../engine/settings';
import type { LoadedCharacter } from '../../engine/pixi/sheet';
import type { ChartFoods } from '../../mods/registry';
import { Monster } from '../monster/monster';
import { SplatLayer } from '../monster/splats';
import {
  buildShareCard,
  cardToBlob,
  copyImageToClipboard,
  downloadBlob,
} from '../sharecard';
import { ResultsOverlay, type ResultsData, type ShareAction } from './results';
import type { Screen } from './screen';

/** How long a note is on screen before its hit moment. */
const APPROACH_MS = 900;
/** Spawn distance from the monster's mouth. */
const TRAVEL_PX = 380;
/** How long missed food keeps flying past before fading out. */
const MISS_LINGER_MS = 350;
const FLOAT_TEXT_MS = 600;
const END_DELAY_MS = 1500;
/** Pause on the KO collapse before the results overlay appears. */
const KO_OVERLAY_DELAY_MS = 1400;

/** Monster sprite centre sits above the note convergence point so the
 *  MOUTH (drawn below frame centre) is what the food flies into. */
const MOUTH_OFFSET_PX = 30;

const HUNGER_MISS = 0.15;
const HUNGER_HIT = 0.03;
const HUNGER_BAR_W = 180;
const HUNGER_BAR_H = 12;

/** Subtle whole-world breathe on downbeats; UI stays fixed. */
const ZOOM_PULSE_DECAY_MS = 140;
const ZOOM_PULSE_AMOUNT = 0.015;
/** Confetti keeps firing on beats this long after a clear. */
const CELEBRATE_CONFETTI_MS = 4000;
/** Comedic KO: one more splat lands every this-many ms during the collapse. */
const KO_SPLAT_RAIN_INTERVAL_MS = 200;
/** How long the float-text spawn pop lasts (scale 1.3 → 1). */
const FLOAT_POP_MS = 100;

const BURST_COUNT: Record<Exclude<Judgment, 'miss'>, number> = {
  perfect: 16,
  good: 9,
  okay: 5,
};

const DIR_VECTORS: Record<Direction, { x: number; y: number }> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
};

/** Food sprite size when the food ships an image (fallback circle is r=18). */
const FOOD_SPRITE_PX = 38;

/** Receptor ring at the hit point: food fills the ring exactly at "press". */
const RECEPTOR_RADIUS_PX = 22;
/** Short lane ticks just outside the ring, marking the four approach axes. */
const RECEPTOR_TICK_INNER_PX = 30;
const RECEPTOR_TICK_OUTER_PX = 42;
const RECEPTOR_ALPHA_BASE = 0.45;
const RECEPTOR_ALPHA_PULSE = 0.3;
const RECEPTOR_PULSE_SCALE = 0.06;

/** Food spawns at this scale and grows linearly to 1.0 at the mouth. */
const NOTE_SPAWN_SCALE = 0.6;
/** Brief fade-in so spawns don't pop into an already-busy scene. */
const NOTE_FADE_IN_MS = 120;

const JUDGMENT_STYLE: Record<Judgment, { label: string; color: string }> = {
  perfect: { label: 'PERFECT!', color: '#7cff6b' },
  good: { label: 'GOOD', color: '#ffd166' },
  okay: { label: 'OKAY', color: '#ffa94d' },
  miss: { label: 'MISS', color: '#ff6b6b' },
};

interface FloatText {
  text: Text;
  bornMs: number;
}

/**
 * Core gameplay: food notes fly at the monster from four directions; note
 * positions are pure functions of song time. Judgment and scoring live in
 * core; the monster reacts to every judgment, its hunger drains on misses
 * (empty = comedic KO), and this screen renders and routes input.
 */
export class GameplayScreen implements Screen {
  readonly view = new Container();
  /** Monster + notes + particles; pulses as one on downbeats. UI stays out. */
  private readonly world = new Container();
  private readonly noteLayer = new Container();
  private readonly uiLayer = new Container();

  private readonly cx: number;
  private readonly cy: number;
  private readonly scoreText: Text;
  private readonly comboText: Text;
  private readonly accText: Text;
  private readonly monster: Monster;
  private readonly hungerBar: Graphics;
  private readonly results: ResultsOverlay;

  private judge: HitJudge;
  private scoreState = new ScoreState();
  private sprites = new Map<number, Container>();
  private missedAtMs = new Map<number, number>();
  private floatTexts: FloatText[] = [];
  private lastHitErrMs: number | null = null;
  private finished = false;
  private hunger = 1;
  private koAtMs: number | null = null;

  private readonly hitstop = new Hitstop();
  private readonly particles = new ParticleSystem();
  private readonly splats = new SplatLayer();
  private readonly receptor = new Graphics();
  private zoomPulse = 0;
  private lastBeat = Number.NEGATIVE_INFINITY;
  private lastDisplayMs: number | null = null;
  private clearedAtMs: number | null = null;
  private lastKoSplatMs = 0;
  private lastResults: ResultsData | null = null;

  constructor(
    private readonly conductor: Conductor,
    private readonly chart: Chart,
    private readonly buffer: AudioBuffer,
    character: LoadedCharacter,
    private readonly foods: ChartFoods,
    audio: AudioContext,
    private readonly renderer: Renderer,
    stageWidth: number,
    stageHeight: number,
  ) {
    this.cx = stageWidth / 2;
    this.cy = stageHeight / 2;
    this.judge = new HitJudge(chart.notes);

    // Monster below the food so incoming notes fly in front of its face.
    this.monster = new Monster(character, audio);
    this.monster.view.position.set(this.cx, this.cy - MOUTH_OFFSET_PX);
    this.monster.attachOverlay(this.splats.view);
    // Pivot at the stage centre so the downbeat zoom breathes in place.
    this.world.pivot.set(this.cx, this.cy);
    this.world.position.set(this.cx, this.cy);
    // Receptor: a fixed ring + lane ticks marking the exact hit point, so
    // the player times against something still. Between monster and notes —
    // reads over the animating body, never occludes food.
    this.receptor
      // Dark halo first so the white ring separates from the bright body.
      .circle(0, 0, RECEPTOR_RADIUS_PX)
      .stroke({ width: 8, color: 0x000000, alpha: 0.45 })
      .circle(0, 0, RECEPTOR_RADIUS_PX)
      .stroke({ width: 3, color: 0xffffff, alpha: 1 });
    for (const v of Object.values(DIR_VECTORS)) {
      this.receptor
        .moveTo(v.x * RECEPTOR_TICK_INNER_PX, v.y * RECEPTOR_TICK_INNER_PX)
        .lineTo(v.x * RECEPTOR_TICK_OUTER_PX, v.y * RECEPTOR_TICK_OUTER_PX)
        .stroke({ width: 3, color: 0xffffff, alpha: 0.7 });
    }
    this.receptor.alpha = RECEPTOR_ALPHA_BASE;
    this.receptor.position.set(this.cx, this.cy);

    this.world.addChild(this.monster.view);
    this.world.addChild(this.receptor);
    this.world.addChild(this.noteLayer);
    this.world.addChild(this.particles.view);
    this.view.addChild(this.world);
    this.view.addChild(this.uiLayer);

    this.scoreText = new Text({
      text: '0',
      style: { fill: '#ffffff', fontSize: 28, fontWeight: 'bold' },
    });
    this.scoreText.anchor.set(1, 0);
    this.scoreText.position.set(stageWidth - 16, 12);
    this.uiLayer.addChild(this.scoreText);

    this.accText = new Text({
      text: '100.0%',
      style: { fill: '#9a9ab0', fontSize: 16 },
    });
    this.accText.anchor.set(1, 0);
    this.accText.position.set(stageWidth - 16, 46);
    this.uiLayer.addChild(this.accText);

    const hungerLabel = new Text({
      text: 'hunger',
      style: { fill: '#9a9ab0', fontSize: 12 },
    });
    hungerLabel.anchor.set(0.5, 0);
    hungerLabel.position.set(this.cx, 12);
    this.uiLayer.addChild(hungerLabel);

    this.hungerBar = new Graphics();
    this.hungerBar.position.set(this.cx - HUNGER_BAR_W / 2, 30);
    this.uiLayer.addChild(this.hungerBar);

    this.comboText = new Text({
      text: '',
      style: { fill: '#ffffff', fontSize: 36, fontWeight: 'bold' },
    });
    this.comboText.anchor.set(0.5);
    this.comboText.position.set(this.cx, stageHeight - 70);
    this.uiLayer.addChild(this.comboText);

    const help = new Text({
      text: `${chart.song.title} — arrows to feed ${this.monster.name} · R restart · Esc menu`,
      style: { fill: '#5f6f76', fontSize: 14 },
    });
    help.position.set(12, stageHeight - 26);
    this.uiLayer.addChild(help);

    this.results = new ResultsOverlay(stageWidth, stageHeight, (action) =>
      this.handleShare(action),
    );
    this.uiLayer.addChild(this.results.view);
  }

  enter(): void {
    this.judge = new HitJudge(this.chart.notes);
    this.scoreState = new ScoreState();
    for (const sprite of this.sprites.values()) sprite.destroy();
    this.sprites.clear();
    this.missedAtMs.clear();
    for (const f of this.floatTexts) f.text.destroy();
    this.floatTexts = [];
    this.lastHitErrMs = null;
    this.finished = false;
    this.hunger = 1;
    this.koAtMs = null;
    this.hitstop.reset();
    this.particles.clear();
    this.splats.clear();
    this.zoomPulse = 0;
    this.lastBeat = Number.NEGATIVE_INFINITY;
    this.lastDisplayMs = null;
    this.clearedAtMs = null;
    this.lastKoSplatMs = 0;
    this.lastResults = null;
    this.monster.reset();
    this.results.hide();
    this.comboText.text = '';
    this.noteLayer.removeChildren();
    this.conductor.startSong(
      this.buffer,
      this.chart.song.bpm,
      this.chart.song.offsetMs,
    );
  }

  exit(): void {
    this.results.hide();
    this.conductor.stop();
  }

  update(): void {
    // Three clocks with distinct roles:
    //  songMs    — judgment truth, straight off AudioContext.currentTime.
    //  displayMs — what the player is HEARING right now (song time minus
    //              output latency); notes and beat effects render to this so
    //              sight and sound agree.
    //  visMs     — juice clock: displayMs clamped by hitstop so a Perfect
    //              freezes the monster/particles 2–3 frames. Note motion is
    //              deliberately exempt — frozen-then-snapping food corrupted
    //              the read on the next note.
    const songMs = this.conductor.songTimeMs();
    const displayMs = this.conductor.displayTimeMs();
    const visMs = this.hitstop.visualMs(displayMs);

    if (!this.finished) {
      // Sweep on the same latency-shifted clock that judges input, so a
      // note stays hittable for as long as it is audibly current.
      for (const noteIndex of this.judge.sweepMisses(displayMs)) {
        this.scoreState.addJudgment('miss');
        this.missedAtMs.set(noteIndex, displayMs);
        this.monster.onMiss();
        this.monster.setCombo(this.scoreState.combo);
        this.hunger = Math.max(0, this.hunger - HUNGER_MISS);
        this.spawnFloatText('miss', this.chart.notes[noteIndex]!, visMs);
        const splat = this.splats.add(
          visMs,
          this.foods.forNote(this.chart.notes[noteIndex]!).tint,
        );
        this.particles.burst(visMs, {
          x: this.cx,
          y: this.cy - MOUTH_OFFSET_PX,
          count: 6,
          colors: [splat.color],
          speed: [40, 140],
          lifeMs: [250, 450],
          size: [2, 4],
          gravity: 500,
        });
      }
      if (this.hunger <= 0) {
        this.knockOut(songMs);
      } else {
        this.updateNoteSprites(displayMs);
      }
    }

    this.updateBeatEffects(displayMs, visMs);
    this.updateKoSplatRain(songMs, visMs);
    this.monster.update(visMs, this.gazeTarget());
    this.splats.update(visMs);
    this.particles.update(visMs);
    this.updateFloatTexts(visMs);
    this.updateHud();
    this.checkEnd(songMs);
  }

  /** Beat-crossing effects: downbeat zoom, receptor pulse, clear confetti. */
  private updateBeatEffects(displayMs: number, visMs: number): void {
    const dt =
      this.lastDisplayMs === null ? 16 : Math.max(0, displayMs - this.lastDisplayMs);
    this.lastDisplayMs = displayMs;

    // Receptor pulses on each HEARD beat — a continuous visual metronome at
    // the exact hit point (same phase/decay feel as the metronome screen).
    const phase = ((this.conductor.beatAt(displayMs) % 1) + 1) % 1;
    const pulse = Math.max(0, 1 - phase / 0.3);
    this.receptor.alpha = RECEPTOR_ALPHA_BASE + RECEPTOR_ALPHA_PULSE * pulse;
    this.receptor.scale.set(1 + RECEPTOR_PULSE_SCALE * pulse);

    const beat = Math.floor(this.conductor.beatAt(displayMs));
    const crossed = beat > this.lastBeat;
    if (crossed) {
      this.lastBeat = beat;
      if (beat >= 0 && beat % 4 === 0) this.zoomPulse = 1;
      // Celebration: confetti raining on every beat, tapering off so it
      // doesn't churn forever under the results panel. Particle birth times
      // stay on visMs to match particles.update(visMs).
      if (
        this.clearedAtMs !== null &&
        visMs < this.clearedAtMs + CELEBRATE_CONFETTI_MS
      ) {
        this.particles.burst(visMs, {
          x: this.cx + (Math.random() - 0.5) * 300,
          y: this.cy - 200,
          count: 14,
          colors: Object.values(this.foods.dirTints),
          speed: [40, 180],
          lifeMs: [700, 1200],
          size: [3, 6],
          gravity: 420,
          angle: [Math.PI * 0.15, Math.PI * 0.85], // downward fan
        });
      }
    }
    this.zoomPulse *= Math.exp(-dt / ZOOM_PULSE_DECAY_MS);
    this.world.scale.set(1 + this.zoomPulse * ZOOM_PULSE_AMOUNT);
  }

  /** Comedic KO: food keeps landing on the collapsed monster for a beat. */
  private updateKoSplatRain(songMs: number, visMs: number): void {
    if (this.koAtMs === null) return;
    if (songMs > this.koAtMs + KO_OVERLAY_DELAY_MS) return;
    if (songMs - this.lastKoSplatMs < KO_SPLAT_RAIN_INTERVAL_MS) return;
    this.lastKoSplatMs = songMs;
    const splat = this.splats.add(visMs);
    this.particles.burst(visMs, {
      x: this.cx + (Math.random() - 0.5) * 120,
      y: this.cy - 160,
      count: 5,
      colors: [splat.color],
      speed: [30, 120],
      lifeMs: [300, 550],
      size: [2, 4],
      gravity: 600,
      angle: [Math.PI * 0.3, Math.PI * 0.7],
    });
  }

  onDir(dir: Direction, audioTimeMs: number): void {
    if (this.finished) return;
    // A player timing to what they HEAR presses outputLatency late relative
    // to the chart; subtract it so calibration only has to capture human +
    // input bias.
    const songMs =
      this.conductor.toSongTimeMs(audioTimeMs) -
      this.conductor.outputLatencyMs() -
      loadCalibrationOffsetMs();
    const hit = this.judge.tryHit(dir, songMs);
    if (!hit) return;
    this.lastHitErrMs = hit.errorMs;
    this.scoreState.addJudgment(hit.judgment);
    this.monster.onHit(hit.judgment, dir);
    this.monster.setCombo(this.scoreState.combo);
    this.hunger = Math.min(1, this.hunger + HUNGER_HIT);
    const sprite = this.sprites.get(hit.noteIndex);
    if (sprite) {
      sprite.destroy();
      this.sprites.delete(hit.noteIndex);
    }

    // Hitstop runs on the display clock (same clock update() feeds it).
    const nowMs = this.conductor.displayTimeMs();
    if (hit.judgment === 'perfect') this.hitstop.trigger(nowMs);
    const visMs = this.hitstop.visualMs(nowMs);
    // Fan the burst along the food's travel direction — across the monster,
    // never back up the lane the next note is arriving on.
    const v = DIR_VECTORS[this.chart.notes[hit.noteIndex]!.dir];
    const a = Math.atan2(-v.y, -v.x);
    this.particles.burst(visMs, {
      x: this.cx,
      y: this.cy,
      count: BURST_COUNT[hit.judgment],
      colors: [this.foods.forNote(this.chart.notes[hit.noteIndex]!).tint, 0xffffff],
      speed: [120, 320],
      lifeMs: [280, 520],
      size: [2, 5],
      gravity: 350,
      angle: [a - 1.1, a + 1.1],
    });
    this.spawnFloatText(hit.judgment, this.chart.notes[hit.noteIndex]!, visMs);
  }

  private updateNoteSprites(displayMs: number): void {
    for (let i = 0; i < this.chart.notes.length; i++) {
      const note = this.chart.notes[i]!;
      const untilHitMs = note.timeMs - displayMs;
      if (untilHitMs > APPROACH_MS) break; // sorted: rest are further out
      if (this.judge.stateOf(i) === 'hit') continue;

      const missedAt = this.missedAtMs.get(i);
      if (missedAt !== undefined && displayMs - missedAt > MISS_LINGER_MS) {
        const sprite = this.sprites.get(i);
        if (sprite) {
          sprite.destroy();
          this.sprites.delete(i);
        }
        continue;
      }

      let sprite = this.sprites.get(i);
      if (!sprite) {
        // Wrapper container: the inner sprite keeps its baked base scale,
        // the wrapper carries the per-frame position/scale/alpha.
        const visual = this.foods.forNote(note);
        sprite = new Container();
        if (visual.texture) {
          const food = new Sprite(visual.texture);
          food.anchor.set(0.5);
          food.scale.set(
            FOOD_SPRITE_PX / Math.max(visual.texture.width, visual.texture.height),
          );
          sprite.addChild(food);
        } else {
          sprite.addChild(new Graphics().circle(0, 0, 18).fill(visual.tint));
        }
        this.sprites.set(i, sprite);
        this.noteLayer.addChild(sprite);
      }

      // Position: pure function of display time. progress 0 = just spawned,
      // 1 = at the mouth; > 1 keeps flying past (missed food overshoots).
      // Motion stays LINEAR — constant velocity is itself a timing cue.
      const progress = 1 - untilHitMs / APPROACH_MS;
      const v = DIR_VECTORS[note.dir];
      sprite.x = this.cx + v.x * TRAVEL_PX * (1 - progress);
      sprite.y = this.cy + v.y * TRAVEL_PX * (1 - progress);
      // Impact cue: food grows to full size exactly at the mouth — "the food
      // fills the receptor ring" is the press signal.
      const grow = Math.min(1, Math.max(0, progress));
      sprite.scale.set(NOTE_SPAWN_SCALE + (1 - NOTE_SPAWN_SCALE) * grow);
      const fadeIn = Math.min(1, (APPROACH_MS - untilHitMs) / NOTE_FADE_IN_MS);
      sprite.alpha =
        fadeIn *
        (missedAt === undefined
          ? 1
          : Math.min(1, Math.max(0, 1 - (displayMs - missedAt) / MISS_LINGER_MS)));
    }
  }

  /** Vector from the monster's centre to the nearest live incoming food. */
  private gazeTarget(): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const [i, sprite] of this.sprites) {
      if (this.missedAtMs.has(i)) continue;
      const dx = sprite.x - this.cx;
      const dy = sprite.y - this.cy;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = { x: dx, y: dy };
      }
    }
    return best;
  }

  private knockOut(songMs: number): void {
    this.finished = true;
    this.koAtMs = songMs;
    this.conductor.stop();
    this.monster.knockOut();
    for (const sprite of this.sprites.values()) sprite.destroy();
    this.sprites.clear();
  }

  private spawnFloatText(judgment: Judgment, note: Note, songMs: number): void {
    const style = JUDGMENT_STYLE[judgment];
    const text = new Text({
      text: style.label,
      style: {
        fill: style.color,
        fontSize: judgment === 'perfect' ? 30 : 26,
        fontWeight: 'bold',
      },
    });
    text.anchor.set(0.5);
    // Perpendicular to the approach axis: near "its" lane but never sitting
    // in the path of the next incoming food.
    const v = DIR_VECTORS[note.dir];
    text.position.set(this.cx + v.y * 80, this.cy - v.x * 80 - 30);
    this.uiLayer.addChild(text);
    this.floatTexts.push({ text, bornMs: songMs });
  }

  private updateFloatTexts(songMs: number): void {
    this.floatTexts = this.floatTexts.filter((f) => {
      const age = songMs - f.bornMs;
      if (age > FLOAT_TEXT_MS) {
        f.text.destroy();
        return false;
      }
      f.text.alpha = Math.min(1, 1 - age / FLOAT_TEXT_MS);
      // Spawn pop: 1.3 → 1 over the first FLOAT_POP_MS.
      const pop = Math.min(1, Math.max(0, age / FLOAT_POP_MS));
      f.text.scale.set(1.3 - 0.3 * pop);
      f.text.y -= 0.8; // cosmetic drift only; lifetime is song-time based
      return true;
    });
  }

  private updateHud(): void {
    this.scoreText.text = String(this.scoreState.score);
    this.accText.text = `${this.scoreState.accuracy().toFixed(1)}%`;
    this.comboText.text =
      this.scoreState.combo >= 2 ? `${this.scoreState.combo} combo` : '';

    const color =
      this.hunger > 0.5 ? '#7cff6b' : this.hunger > 0.25 ? '#ffd166' : '#ff6b6b';
    this.hungerBar
      .clear()
      .roundRect(0, 0, HUNGER_BAR_W, HUNGER_BAR_H, 6)
      .fill('#26263a');
    if (this.hunger > 0) {
      this.hungerBar
        .roundRect(1, 1, (HUNGER_BAR_W - 2) * this.hunger, HUNGER_BAR_H - 2, 5)
        .fill(color);
    }
  }

  private checkEnd(songMs: number): void {
    if (this.koAtMs !== null) {
      if (!this.results.visible && songMs > this.koAtMs + KO_OVERLAY_DELAY_MS) {
        this.showEnd(`KO! ${this.monster.name} fainted from hunger`);
      }
      return;
    }
    if (this.finished) return;
    const lastNote = this.chart.notes[this.chart.notes.length - 1]!;
    const chartDone =
      this.judge.allJudged && songMs > lastNote.timeMs + END_DELAY_MS;
    if (!chartDone && !this.conductor.ended) return;

    this.finished = true;
    this.clearedAtMs = songMs;
    this.monster.celebrate();
    this.showEnd(`${this.monster.name} is stuffed and happy!`);
  }

  private showEnd(headline: string): void {
    const s = this.scoreState;
    this.lastResults = {
      headline,
      grade: gradeFor(s.accuracy(), s.isFullCombo),
      score: s.score,
      accuracyPct: s.accuracy(),
      maxCombo: s.maxCombo,
      counts: s.counts,
      fullCombo: s.isFullCombo,
    };
    this.results.show(this.lastResults);
  }

  /** Build the share card from the monster's current state and export it. */
  private handleShare(action: ShareAction): void {
    const data = this.lastResults;
    if (!data) return;
    const card = buildShareCard({
      grade: data.grade,
      score: data.score,
      accuracyPct: data.accuracyPct,
      maxCombo: data.maxCombo,
      songTitle: this.chart.song.title,
      monsterName: this.monster.name,
      headline: data.headline,
      monsterTexture: this.monster.currentTexture,
      splats: this.splats.specs,
    });
    const blobPromise = cardToBlob(this.renderer, card).finally(() =>
      card.destroy({ children: true }),
    );
    if (action === 'download') {
      void blobPromise
        .then((blob) =>
          downloadBlob(blob, `monster-feeder-${data.grade}.png`),
        )
        .catch((err) => console.error('share card download failed', err));
    } else {
      // The promise (not the blob) must reach ClipboardItem synchronously
      // inside the click gesture — copyImageToClipboard does exactly that.
      void copyImageToClipboard(blobPromise);
    }
  }

  // Debug overlay accessors (main.ts)
  get lastErrorMs(): number | null {
    return this.lastHitErrMs;
  }

  nextNoteLabel(): string {
    // Display clock: "in 0ms" is when the player should press.
    const displayMs = this.conductor.displayTimeMs();
    const i = this.judge.nextPendingIndex(displayMs);
    if (i === null) return '—';
    const n = this.chart.notes[i]!;
    return `${n.dir} in ${(n.timeMs - displayMs).toFixed(0)}ms`;
  }

  judgedLabel(): string {
    return `${this.judge.judgedCount}/${this.judge.totalCount}`;
  }

  static readonly okayWindowMs = WINDOWS.okay;
}
