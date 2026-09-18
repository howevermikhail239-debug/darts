import { describe, expect, it } from 'vitest';
import { createMatch } from '../src/domain/match/createMatch';
import type { Match } from '../src/domain/match/models';
import { x01WinProbability } from '../src/domain/competitive/winProbability';

const at = '2026-01-01T12:00:00.000Z';
const match = (remaining: Record<string, number>, currentPlayerIndex = 0): Match => {
  const base = createMatch('m', ['a', 'b'], { mode: 'x01', format: { kind: 'unlimited' }, startingPlayerIndex: 0 }, at);
  return { ...base, currentPlayerIndex, state: { ...base.state, remaining } } as Match;
};

describe('x01WinProbability', () => {
  it('is seeded, bounded, and sums to 100', () => {
    const current = match({ a: 101, b: 101 });
    const first = x01WinProbability(current, { a: [60, 60], b: [60, 60] }, 42, 300)!;
    const second = x01WinProbability(current, { a: [60, 60], b: [60, 60] }, 42, 300)!;
    expect(first).toEqual(second);
    expect(first.probabilities.a! + first.probabilities.b!).toBeCloseTo(100);
  });

  it('raises the estimate for the player with a much stronger live position', () => {
    const estimate = x01WinProbability(match({ a: 40, b: 301 }), { a: [40], b: [20] }, 9, 500)!;
    expect(estimate.probabilities.a!).toBeGreaterThan(estimate.probabilities.b!);
    expect(estimate.confidence).toBe('low');
  });

  it('returns a certain outcome for a completed match', () => {
    const completed = { ...match({ a: 0, b: 40 }), status: 'completed' as const, winnerId: 'a', completedAt: at };
    expect(x01WinProbability(completed)!.probabilities).toEqual({ a: 100, b: 0 });
  });
});
