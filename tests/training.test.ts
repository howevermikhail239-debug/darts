import { describe, expect, it } from 'vitest';
import { bobs27Score, doublesClockTargets, summarizeTraining } from '../src/domain/competitive/training';

describe('training domain', () => {
  it('keeps double accuracy and streaks separate from match statistics', () => {
    const summary = summarizeTraining([
      { target: 'D20', darts: ['D20'], success: true },
      { target: 'D20', darts: ['MISS'], success: false },
      { target: 'Bull', darts: ['Bull'], success: true },
    ]);
    expect(summary).toMatchObject({
      attempts: 3,
      hits: 2,
      accuracy: (100 / 3) * 2,
      darts: 3,
      streak: 1,
      bestStreak: 1,
    });
    expect(summary.byTarget).toEqual({ D20: { attempts: 2, hits: 1 }, Bull: { attempts: 1, hits: 1 } });
  });
  it("implements Bob's 27 scoring and the full double clock", () => {
    expect(doublesClockTargets).toHaveLength(21);
    expect(
      bobs27Score([
        { target: 'D1', darts: ['D1'], success: true },
        { target: 'D2', darts: ['MISS'], success: false },
      ]),
    ).toBe(27);
  });
});
