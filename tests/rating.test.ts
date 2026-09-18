import { describe, expect, it } from 'vitest';
import { ratingsForMatches } from '../src/domain/competitive/rating';
import { createMatch } from '../src/domain/match/createMatch';

const completed = (id: string, players: readonly string[], winnerId?: string) => ({
  ...createMatch(
    id,
    players,
    { mode: 'x01', format: { kind: 'unlimited' }, startingPlayerIndex: 0 },
    `2026-09-18T0${id}:00:00.000Z`,
  ),
  status: 'completed' as const,
  completedAt: `2026-09-18T0${id}:00:00.000Z`,
  ...(winnerId ? { winnerId } : {}),
});

describe('derived Elo rating', () => {
  it('is deterministic and rewards an upset more than an expected win', () => {
    const history = [completed('1', ['a', 'b'], 'a'), completed('2', ['a', 'b'], 'a'), completed('3', ['a', 'b'], 'b')];
    const first = ratingsForMatches(history, ['a', 'b']);
    const second = ratingsForMatches(history, ['a', 'b']);
    expect(first).toEqual(second);
    const events = first.get('b')!.events;
    expect(events[2]!.delta).toBeGreaterThan(events[0]!.delta);
  });
  it('keeps a draw symmetric and updates every participant in a multi-player result', () => {
    const draw = ratingsForMatches([completed('1', ['a', 'b'])], ['a', 'b']);
    expect(draw.get('a')!.rating).toBe(1500);
    expect(draw.get('b')!.rating).toBe(1500);
    const multi = ratingsForMatches([completed('2', ['a', 'b', 'c'], 'a')], ['a', 'b', 'c']);
    expect(multi.get('a')!.rating).toBeGreaterThan(1500);
    expect(multi.get('b')!.rating).toBeLessThan(1500);
    expect(multi.get('c')!.rating).toBeLessThan(1500);
  });
});
