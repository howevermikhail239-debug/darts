import { describe, expect, it } from 'vitest';
import { notationOf, numberThrow, outerBull, bull, miss, scoreOf, type DartThrow } from '../src/domain/darts/DartThrow';
import { checkoutSuggestion } from '../src/domain/rules/checkoutSuggestion';
import { createMatch } from '../src/domain/match/createMatch';
import type { Match, Visit } from '../src/domain/match/models';
import { currentStreak, recentForm } from '../src/domain/statistics/todaySummary';
import {
  headToHead,
  recordsForPlayer,
  statisticsForPlayerHistory,
} from '../src/domain/statistics/StatisticsCalculator';

const route = (score: number, darts = 3, rule: 'straight' | 'double' = 'double') =>
  checkoutSuggestion(score, darts, rule)?.map(notationOf).join(' · ');
const at = (day: number) => `2026-09-${String(day).padStart(2, '0')}T12:00:00.000Z`;
function makeVisit(id: string, playerId: string, darts: readonly DartThrow[]): Visit {
  const points = darts.reduce((sum, dart) => sum + scoreOf(dart), 0);
  return {
    id,
    matchId: id,
    playerId,
    visitIndex: 0,
    inputKind: 'detailed',
    darts,
    physicalDartsUsed: darts.length,
    rawScore: points,
    awardedScore: points,
    before: { scores: { a: 501, b: 501 }, currentPlayerIndex: 0 },
    after: { scores: { a: 501, b: 501 }, currentPlayerIndex: 1 },
    result: 'scored',
    timestamp: at(1),
  };
}
function makeMatch(
  id: string,
  day: number,
  winnerId: string | undefined,
  darts: readonly DartThrow[] = [numberThrow(20, 1)],
): Match {
  const base = createMatch(
    id,
    ['a', 'b'],
    { mode: 'x01', startingScore: 501, outRule: 'double', format: { kind: 'unlimited' }, startingPlayerIndex: 0 },
    at(day),
  );
  return {
    ...base,
    status: 'completed',
    completedAt: at(day),
    confirmedVisits: [makeVisit(`${id}-v`, 'a', darts)],
    ...(winnerId ? { winnerId } : {}),
  };
}

describe('checkout suggestions', () => {
  it.each([
    [170, 'T20 · T20 · Bull'],
    [167, 'T20 · T19 · Bull'],
    [164, 'T20 · T18 · Bull'],
    [161, 'T20 · T17 · Bull'],
    [160, 'T20 · T20 · D20'],
    [121, 'T20 · T11 · D14'],
    [100, 'T20 · D20'],
    [80, 'T20 · D10'],
    [40, 'D20'],
    [32, 'D16'],
  ] as const)('offers a deterministic route for %i', (score, expected) => expect(route(score)).toBe(expected));
  it.each([169, 168, 166, 165, 163, 162, 159])('rejects bogey %i', (score) => expect(route(score)).toBeUndefined());
  it('honours darts remaining and out rule', () => {
    expect(route(100, 1)).toBeUndefined();
    expect(route(100, 2)).toBe('T20 · D20');
    expect(route(40, 1)).toBe('D20');
    expect(route(40, 3, 'straight')).toBe('D20');
    expect(route(1, 1, 'straight')).toBe('S1');
  });
});

describe('derived release statistics', () => {
  it('uses one reset cutoff for matches, hits, form, records and H2H', () => {
    const old = makeMatch('old', 1, 'a', [numberThrow(20, 3), numberThrow(20, 3), numberThrow(20, 3)]),
      fresh = makeMatch('fresh', 3, 'b', [outerBull(), bull(), miss()]);
    const resetAt = at(2),
      stats = statisticsForPlayerHistory([old, fresh], 'a', 'all', 'all', resetAt);
    expect(stats).toMatchObject({
      matches: 1,
      wins: 0,
      losses: 1,
      knownHitDarts: 3,
      outerBulls: 1,
      bulls: 1,
      misses: 1,
      bestVisit: 75,
    });
    expect(stats.hitCounts).toEqual({ '25': 1, Bull: 1, MISS: 1 });
    expect(recentForm([old, fresh], 'a', 5, resetAt)).toEqual(['loss']);
    expect(recordsForPlayer([old, fresh], 'a', 'all', resetAt).bestVisit).toBe(75);
    expect(headToHead([old, fresh], 'a', 'b', 'all', resetAt)).toMatchObject({
      sharedMatches: 1,
      playerAWins: 0,
      playerBWins: 1,
    });
  });
  it('recomputes streaks and personal bests from remaining matches after deletion', () => {
    const first = makeMatch('first', 1, 'a', [numberThrow(20, 3)]),
      record = makeMatch('record', 2, 'a', [numberThrow(20, 3), numberThrow(20, 3)]),
      latest = makeMatch('latest', 3, 'b', [numberThrow(20, 1)]);
    expect(recordsForPlayer([first, record, latest], 'a').bestVisit).toBe(120);
    expect(recordsForPlayer([first, latest], 'a').bestVisit).toBe(60);
    expect(currentStreak([first, record], 'a')).toEqual({ result: 'win', count: 2 });
    expect(currentStreak([first, record, latest], 'a')).toEqual({ result: 'loss', count: 1 });
    expect(currentStreak([first, latest], 'a')).toEqual({ result: 'loss', count: 1 });
  });
  it('treats a draw as its own streak and reset clears earlier streaks', () => {
    const win = makeMatch('win', 1, 'a'),
      draw = makeMatch('draw', 2, undefined);
    expect(currentStreak([win, draw], 'a')).toEqual({ result: 'draw', count: 1 });
    expect(currentStreak([win], 'a', at(2))).toBeUndefined();
  });
});
