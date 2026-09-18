import type { TrainingAttempt, TrainingSession } from './models';

export type TrainingSummary = Readonly<{
  attempts: number;
  hits: number;
  accuracy: number;
  darts: number;
  streak: number;
  bestStreak: number;
  bestScore: number;
  byTarget: Readonly<Record<string, Readonly<{ attempts: number; hits: number }>>>;
}>;
export const doublesClockTargets = [...Array.from({ length: 20 }, (_, index) => `D${index + 1}`), 'Bull'] as const;

export function summarizeTraining(attempts: readonly TrainingAttempt[]): TrainingSummary {
  let hits = 0,
    darts = 0,
    streak = 0,
    bestStreak = 0,
    bestScore = 0;
  const byTarget: Record<string, { attempts: number; hits: number }> = {};
  for (const attempt of attempts) {
    darts += attempt.darts.length;
    bestScore = Math.max(bestScore, attempt.score ?? 0);
    const item = (byTarget[attempt.target] ??= { attempts: 0, hits: 0 });
    item.attempts += 1;
    if (attempt.success) {
      hits += 1;
      item.hits += 1;
      streak += 1;
      bestStreak = Math.max(bestStreak, streak);
    } else streak = 0;
  }
  return {
    attempts: attempts.length,
    hits,
    accuracy: attempts.length ? (hits * 100) / attempts.length : 0,
    darts,
    streak,
    bestStreak,
    bestScore,
    byTarget,
  };
}

/** Bob's 27 starts at 27; a hit adds its double value, a miss subtracts the target value. */
export function bobs27Score(attempts: readonly TrainingAttempt[]): number {
  return attempts.reduce(
    (score, attempt) =>
      score + (attempt.success ? Number(attempt.target.slice(1)) * 2 : -Number(attempt.target.slice(1))),
    27,
  );
}

export function trainingHistory(sessions: readonly TrainingSession[]): TrainingSummary {
  return summarizeTraining(sessions.flatMap((session) => session.attempts));
}
