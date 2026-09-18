import { describe, expect, it } from 'vitest';
import { numberThrow, scoreOf, type DartThrow } from '../src/domain/darts/DartThrow';
import { createMatch } from '../src/domain/match/createMatch';
import type { DetailedVisit, Match, PlayerId, Visit, VisitResult } from '../src/domain/match/models';
import { x01Analytics } from '../src/domain/statistics/x01Analytics';

const at = '2026-01-01T12:00:00.000Z';

function visit(
  id: string,
  playerId: PlayerId,
  darts: readonly DartThrow[],
  beforeScore: number,
  afterScore: number,
  result: VisitResult = 'scored',
): DetailedVisit {
  const rawScore = darts.reduce((total, dart) => total + scoreOf(dart), 0);
  return {
    id,
    matchId: 'match',
    playerId,
    visitIndex: Number(id.slice(1)),
    darts,
    physicalDartsUsed: darts.length,
    rawScore,
    awardedScore: result === 'bust' ? 0 : rawScore,
    before: { scores: { a: beforeScore, b: 501 }, currentPlayerIndex: 0 },
    after: { scores: { a: afterScore, b: 501 }, currentPlayerIndex: 1 },
    result,
    timestamp: at,
  };
}

function x01Match(visits: readonly Visit[]): Match {
  const match = createMatch(
    'match',
    ['a', 'b'],
    { mode: 'x01', format: { kind: 'unlimited' }, startingPlayerIndex: 0 },
    at,
  );
  return { ...match, status: 'completed', completedAt: at, winnerId: 'a', confirmedVisits: visits };
}

describe('x01Analytics', () => {
  it('derives first-nine, checkout, doubles, busts, and checkpoints from confirmed visits', () => {
    const analytics = x01Analytics(
      [
        x01Match([
          visit('v1', 'a', [numberThrow(20, 3), numberThrow(20, 3), numberThrow(20, 3)], 501, 321),
          visit('v2', 'a', [numberThrow(20, 3), numberThrow(20, 3), numberThrow(20, 3)], 321, 141),
          visit('v3', 'a', [numberThrow(20, 1), numberThrow(20, 1), numberThrow(20, 1)], 141, 81),
          visit('v4', 'a', [numberThrow(20, 2)], 40, 0, 'match_won'),
          visit('v5', 'a', [numberThrow(20, 3)], 32, 32, 'bust'),
        ]),
      ],
      'a',
    );

    expect(analytics).toMatchObject({
      first9Average: 140,
      checkoutAttempts: 3,
      successfulCheckouts: 1,
      highestCheckout: 40,
      busts: 1,
      bustRate: 20,
      doubleAttempts: 1,
      doubleHits: 1,
    });
    expect(analytics.checkoutPercent).toBeCloseTo(100 / 3);
    expect(analytics.doubles).toEqual({ D20: { attempts: 1, hits: 1 } });
    expect(analytics.averageRemainingAfter).toMatchObject({ 3: 81, 6: undefined });
  });

  it('does not invent double detail from aggregate score visits', () => {
    const aggregate: Visit = {
      id: 'v1',
      matchId: 'match',
      playerId: 'a',
      visitIndex: 1,
      inputKind: 'aggregate',
      aggregateScore: 40,
      physicalDartsUsed: 3,
      rawScore: 40,
      awardedScore: 40,
      before: { scores: { a: 40, b: 501 }, currentPlayerIndex: 0 },
      after: { scores: { a: 0, b: 501 }, currentPlayerIndex: 1 },
      result: 'match_won',
      timestamp: at,
    };
    const analytics = x01Analytics([x01Match([aggregate])], 'a');

    expect(analytics.checkoutAttempts).toBe(1);
    expect(analytics.successfulCheckouts).toBe(1);
    expect(analytics.doubleAttempts).toBe(0);
    expect(analytics.doubles).toEqual({});
  });
});
