import { Container, Graphics, Text } from 'pixi.js';
import type { Chart, Direction, Note } from '../../core/chart';
import type { Conductor } from '../../core/conductor';
import { HitJudge, WINDOWS, type Judgment } from '../../core/judge';
import { ScoreState } from '../../core/score';
import { loadCalibrationOffsetMs } from '../../core/settings';
import type { LoadedCharacter } from '../../core/sheet';
import { Monster } from '../monster/monster';
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

const DIR_VECTORS: Record<Direction, { x: number; y: number }> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
};

const FOOD_COLORS: Record<Direction, string> = {
  left: '#ffd166',
  right: '#ff5c8a',
  up: '#66d9ff',
  down: '#9dff6b',
};

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
  private readonly noteLayer = new Container();
  private readonly uiLayer = new Container();

  private readonly cx: number;
  private readonly cy: number;
  private readonly scoreText: Text;
  private readonly comboText: Text;
  private readonly accText: Text;
  private readonly monster: Monster;
  private readonly hungerBar: Graphics;
  private readonly endOverlay: Container;
  private readonly endText: Text;

  private judge: HitJudge;
  private scoreState = new ScoreState();
  private sprites = new Map<number, Graphics>();
  private missedAtMs = new Map<number, number>();
  private floatTexts: FloatText[] = [];
  private lastHitErrMs: number | null = null;
  private finished = false;
  private hunger = 1;
  private koAtMs: number | null = null;

  constructor(
    private readonly conductor: Conductor,
    private readonly chart: Chart,
    private readonly buffer: AudioBuffer,
    character: LoadedCharacter,
    audio: AudioContext,
    stageWidth: number,
    stageHeight: number,
  ) {
    this.cx = stageWidth / 2;
    this.cy = stageHeight / 2;
    this.judge = new HitJudge(chart.notes);

    // Monster below the food so incoming notes fly in front of its face.
    this.monster = new Monster(character, audio);
    this.monster.view.position.set(this.cx, this.cy - MOUTH_OFFSET_PX);
    this.view.addChild(this.monster.view);
    this.view.addChild(this.noteLayer);
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

    // Results panel sits at the top so the celebrating (or KO'd) monster
    // stays visible underneath it.
    this.endOverlay = new Container();
    const panel = new Graphics()
      .roundRect(this.cx - 250, 56, 500, 204, 16)
      .fill({ color: '#0d0d12', alpha: 0.92 });
    this.endOverlay.addChild(panel);
    this.endText = new Text({
      text: '',
      style: {
        fill: '#ffffff',
        fontSize: 18,
        align: 'center',
        lineHeight: 27,
      },
    });
    this.endText.anchor.set(0.5);
    this.endText.position.set(this.cx, 158);
    this.endOverlay.addChild(this.endText);
    this.endOverlay.visible = false;
    this.uiLayer.addChild(this.endOverlay);
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
    this.monster.reset();
    this.endOverlay.visible = false;
    this.comboText.text = '';
    this.noteLayer.removeChildren();
    this.conductor.startSong(
      this.buffer,
      this.chart.song.bpm,
      this.chart.song.offsetMs,
    );
  }

  exit(): void {
    this.conductor.stop();
  }

  update(): void {
    const songMs = this.conductor.songTimeMs();

    if (!this.finished) {
      for (const noteIndex of this.judge.sweepMisses(songMs)) {
        this.scoreState.addJudgment('miss');
        this.missedAtMs.set(noteIndex, songMs);
        this.monster.onMiss();
        this.monster.setCombo(this.scoreState.combo);
        this.hunger = Math.max(0, this.hunger - HUNGER_MISS);
        this.spawnFloatText('miss', this.chart.notes[noteIndex]!, songMs);
      }
      if (this.hunger <= 0) {
        this.knockOut(songMs);
      } else {
        this.updateNoteSprites(songMs);
      }
    }

    this.monster.update(songMs, this.gazeTarget());
    this.updateFloatTexts(songMs);
    this.updateHud();
    this.checkEnd(songMs);
  }

  onDir(dir: Direction, audioTimeMs: number): void {
    if (this.finished) return;
    const songMs =
      this.conductor.toSongTimeMs(audioTimeMs) - loadCalibrationOffsetMs();
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
    this.spawnFloatText(
      hit.judgment,
      this.chart.notes[hit.noteIndex]!,
      this.conductor.songTimeMs(),
    );
  }

  private updateNoteSprites(songMs: number): void {
    for (let i = 0; i < this.chart.notes.length; i++) {
      const note = this.chart.notes[i]!;
      const untilHitMs = note.timeMs - songMs;
      if (untilHitMs > APPROACH_MS) break; // sorted: rest are further out
      if (this.judge.stateOf(i) === 'hit') continue;

      const missedAt = this.missedAtMs.get(i);
      if (missedAt !== undefined && songMs - missedAt > MISS_LINGER_MS) {
        const sprite = this.sprites.get(i);
        if (sprite) {
          sprite.destroy();
          this.sprites.delete(i);
        }
        continue;
      }

      let sprite = this.sprites.get(i);
      if (!sprite) {
        sprite = new Graphics().circle(0, 0, 18).fill(FOOD_COLORS[note.dir]);
        this.sprites.set(i, sprite);
        this.noteLayer.addChild(sprite);
      }

      // Position: pure function of song time. progress 0 = just spawned,
      // 1 = at the mouth; > 1 keeps flying past (missed food overshoots).
      const progress = 1 - untilHitMs / APPROACH_MS;
      const v = DIR_VECTORS[note.dir];
      sprite.x = this.cx + v.x * TRAVEL_PX * (1 - progress);
      sprite.y = this.cy + v.y * TRAVEL_PX * (1 - progress);
      sprite.alpha =
        missedAt === undefined
          ? 1
          : Math.max(0, 1 - (songMs - missedAt) / MISS_LINGER_MS);
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
      style: { fill: style.color, fontSize: 26, fontWeight: 'bold' },
    });
    text.anchor.set(0.5);
    const v = DIR_VECTORS[note.dir];
    text.position.set(this.cx + v.x * 110, this.cy + v.y * 110 - 40);
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
      f.text.alpha = 1 - age / FLOAT_TEXT_MS;
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
      if (!this.endOverlay.visible && songMs > this.koAtMs + KO_OVERLAY_DELAY_MS) {
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
    this.monster.celebrate();
    this.showEnd(`${this.monster.name} is stuffed and happy!`);
  }

  private showEnd(headline: string): void {
    const s = this.scoreState;
    this.endText.text = [
      headline,
      '',
      `score  ${s.score}`,
      `accuracy  ${s.accuracy().toFixed(1)}%   max combo  ${s.maxCombo}`,
      `perfect ${s.counts.perfect} · good ${s.counts.good} · okay ${s.counts.okay} · miss ${s.counts.miss}`,
      '',
      'R — retry     Esc — menu',
    ].join('\n');
    this.endOverlay.visible = true;
  }

  // Debug overlay accessors (main.ts)
  get lastErrorMs(): number | null {
    return this.lastHitErrMs;
  }

  nextNoteLabel(): string {
    const songMs = this.conductor.songTimeMs();
    const i = this.judge.nextPendingIndex(songMs);
    if (i === null) return '—';
    const n = this.chart.notes[i]!;
    return `${n.dir} in ${(n.timeMs - songMs).toFixed(0)}ms`;
  }

  judgedLabel(): string {
    return `${this.judge.judgedCount}/${this.judge.totalCount}`;
  }

  static readonly okayWindowMs = WINDOWS.okay;
}
