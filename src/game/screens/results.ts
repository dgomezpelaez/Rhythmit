/**
 * ResultsOverlay — the end-of-song panel: big letter grade, stats, and the
 * share buttons. It lives inside the gameplay screen's UI layer (a separate
 * Screen would stop the conductor and kill the post-song celebration/KO
 * animation underneath). The Save/Copy buttons are DOM, not Pixi: clipboard
 * writes need a real user gesture, and DOM buttons sidestep the global
 * pointerdown → onTap listener in main.ts.
 */

import { Container, Graphics, Text } from 'pixi.js';
import type { Grade, Judgment } from '../../engine';

export interface ResultsData {
  headline: string;
  grade: Grade;
  score: number;
  accuracyPct: number;
  maxCombo: number;
  counts: Readonly<Record<Judgment, number>>;
  fullCombo: boolean;
}

const GRADE_COLORS: Record<Grade, string> = {
  S: '#ffd700',
  A: '#7cff6b',
  B: '#ffd166',
  C: '#9a9ab0',
};

export type ShareAction = 'download' | 'copy';

export class ResultsOverlay {
  readonly view = new Container();
  private readonly headlineText: Text;
  private readonly gradeText: Text;
  private readonly fullComboText: Text;
  private readonly statsText: Text;
  private readonly shareActions: HTMLElement;
  private busy = false;

  constructor(
    stageWidth: number,
    _stageHeight: number,
    onShare: (action: ShareAction) => void,
  ) {
    const cx = stageWidth / 2;

    // Panel at the top so the celebrating (or KO'd, food-covered) monster
    // stays visible underneath.
    const panel = new Graphics()
      .roundRect(cx - 270, 44, 540, 224, 16)
      .fill({ color: '#0d0d12', alpha: 0.92 });
    this.view.addChild(panel);

    this.headlineText = new Text({
      text: '',
      style: { fill: '#ffffff', fontSize: 20, fontWeight: 'bold' },
    });
    this.headlineText.anchor.set(0.5, 0);
    this.headlineText.position.set(cx, 62);
    this.view.addChild(this.headlineText);

    this.gradeText = new Text({
      text: '',
      style: { fill: '#ffffff', fontSize: 84, fontWeight: 'bold' },
    });
    this.gradeText.anchor.set(0.5);
    this.gradeText.position.set(cx - 170, 165);
    this.view.addChild(this.gradeText);

    this.fullComboText = new Text({
      text: 'FULL COMBO',
      style: { fill: '#ffd700', fontSize: 14, fontWeight: 'bold' },
    });
    this.fullComboText.anchor.set(0.5);
    this.fullComboText.position.set(cx - 170, 218);
    this.view.addChild(this.fullComboText);

    this.statsText = new Text({
      text: '',
      style: { fill: '#ffffff', fontSize: 17, lineHeight: 26 },
    });
    this.statsText.anchor.set(0, 0.5);
    this.statsText.position.set(cx - 90, 162);
    this.view.addChild(this.statsText);

    const hint = new Text({
      text: 'R — retry     Esc — menu',
      style: { fill: '#9a9ab0', fontSize: 14 },
    });
    hint.anchor.set(0.5, 0);
    hint.position.set(cx, 242);
    this.view.addChild(hint);

    this.view.visible = false;

    this.shareActions = document.querySelector('#share-actions')!;
    const save = document.querySelector('#btn-save')!;
    const copy = document.querySelector('#btn-copy') as HTMLElement;
    save.addEventListener('click', () => this.runShare(onShare, 'download'));
    copy.addEventListener('click', () => this.runShare(onShare, 'copy'));
    if (typeof ClipboardItem === 'undefined') copy.style.display = 'none';
  }

  show(data: ResultsData): void {
    this.headlineText.text = data.headline;
    this.gradeText.text = data.grade;
    this.gradeText.style.fill = GRADE_COLORS[data.grade];
    this.fullComboText.visible = data.fullCombo;
    const c = data.counts;
    this.statsText.text = [
      `score  ${data.score}`,
      `accuracy  ${data.accuracyPct.toFixed(1)}%   max combo  ${data.maxCombo}`,
      `perfect ${c.perfect} · good ${c.good} · okay ${c.okay} · miss ${c.miss}`,
    ].join('\n');
    this.view.visible = true;
    this.shareActions.classList.remove('hidden');
  }

  hide(): void {
    this.view.visible = false;
    this.shareActions.classList.add('hidden');
  }

  get visible(): boolean {
    return this.view.visible;
  }

  /** Serialize share clicks so a slow export can't be double-fired. */
  private runShare(
    onShare: (action: ShareAction) => void,
    action: ShareAction,
  ): void {
    if (this.busy || !this.view.visible) return;
    this.busy = true;
    try {
      onShare(action);
    } finally {
      // The clipboard write itself is async but must be *started* inside
      // this click handler; releasing here is enough to stop double-fires.
      this.busy = false;
    }
  }
}
