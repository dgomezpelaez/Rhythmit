import type { Judgment } from './judge';

const POINTS: Record<Judgment, number> = {
  perfect: 100,
  good: 60,
  okay: 30,
  miss: 0,
};

/** Accuracy weight per judgment (perfect play = 100%). */
const ACC_WEIGHT: Record<Judgment, number> = {
  perfect: 1,
  good: 0.6,
  okay: 0.3,
  miss: 0,
};

export class ScoreState {
  score = 0;
  combo = 0;
  maxCombo = 0;
  readonly counts: Record<Judgment, number> = {
    perfect: 0,
    good: 0,
    okay: 0,
    miss: 0,
  };

  addJudgment(judgment: Judgment): void {
    this.counts[judgment] += 1;
    this.score += POINTS[judgment];
    if (judgment === 'miss') {
      this.combo = 0;
    } else {
      this.combo += 1;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
    }
  }

  get judged(): number {
    return (
      this.counts.perfect + this.counts.good + this.counts.okay + this.counts.miss
    );
  }

  /** 0–100, weighted by judgment quality over judged notes. */
  accuracy(): number {
    if (this.judged === 0) return 100;
    const weighted =
      this.counts.perfect * ACC_WEIGHT.perfect +
      this.counts.good * ACC_WEIGHT.good +
      this.counts.okay * ACC_WEIGHT.okay;
    return (weighted / this.judged) * 100;
  }
}
