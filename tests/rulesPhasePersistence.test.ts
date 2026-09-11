import { describe, expect, it } from 'vitest';
import { isStoredMatch } from '../src/domain/match/validation';
import { createMatch } from '../src/domain/match/createMatch';
import type { Match } from '../src/domain/match/models';

const at = '2026-09-11T12:00:00.000Z';
describe('phase persistence compatibility', () => {
  it('accepts every new and legacy phase shape', () => {
    const fixed = createMatch(
      'f',
      ['a', 'b', 'c'],
      { mode: 'fixed_visits', visitsPerPlayer: 1, startingPlayerIndex: 0 },
      at,
    );
    if (fixed.state.kind !== 'fixed_visits') throw new Error('setup');
    const withPhase = (phase: unknown): Match => ({
      ...fixed,
      status: 'in_progress',
      state: { ...fixed.state, phase } as never,
    });
    for (const phase of [
      { kind: 'awaiting_tie_decision', playerIds: ['a', 'b'], round: 1 },
      { kind: 'awaiting_tie_decision', round: 1 },
      { kind: 'extra_round', playerIds: ['a', 'b'], completedPlayerIds: ['a'], roundScores: { a: 5 }, round: 1 },
      { kind: 'extra_round', round: 2 },
    ])
      expect([phase, isStoredMatch(withPhase(phase))]).toEqual([phase, true]);
    const drawn: Match = {
      ...withPhase({ kind: 'completed_draw', playerIds: ['a', 'b'], round: 2 }),
      status: 'completed',
      completedAt: at,
    };
    expect(isStoredMatch(drawn)).toBe(true);

    const x01 = createMatch(
      'x',
      ['a', 'b'],
      { mode: 'x01', format: { kind: 'limited', visitsPerPlayer: 1 }, startingPlayerIndex: 0 },
      at,
    );
    if (x01.state.kind !== 'x01') throw new Error('setup');
    const x01Draw: Match = {
      ...x01,
      status: 'completed',
      completedAt: at,
      state: { ...x01.state, phase: { kind: 'completed_draw', playerIds: ['a', 'b'], round: 2 } },
    };
    expect(isStoredMatch(x01Draw)).toBe(true);
  });
});
