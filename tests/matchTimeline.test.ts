import { describe, expect, it } from 'vitest';
import { numberThrow } from '../src/domain/darts/DartThrow';
import { createMatch } from '../src/domain/match/createMatch';
import type { DetailedVisit, Match } from '../src/domain/match/models';
import { matchTimeline } from '../src/domain/statistics/matchTimeline';

const at = '2026-01-01T12:00:00.000Z';
const visit = (
  id: string,
  playerId: string,
  before: number,
  after: number,
  score: number,
  result: DetailedVisit['result'] = 'scored',
): DetailedVisit => ({
  id,
  matchId: 'm',
  playerId,
  visitIndex: Number(id.slice(1)),
  darts: [numberThrow(20, score === 40 ? 2 : 3)],
  physicalDartsUsed: 1,
  rawScore: score,
  awardedScore: score,
  before: { scores: { a: playerId === 'a' ? before : 101, b: playerId === 'b' ? before : 101 }, currentPlayerIndex: 0 },
  after: { scores: { a: playerId === 'a' ? after : 101, b: playerId === 'b' ? after : 101 }, currentPlayerIndex: 1 },
  result,
  timestamp: at,
});

describe('matchTimeline', () => {
  it('derives ordered scoring, checkout, lead, and completion events from visits', () => {
    const base = createMatch(
      'm',
      ['a', 'b'],
      { mode: 'x01', format: { kind: 'unlimited' }, startingPlayerIndex: 0 },
      at,
    );
    const match: Match = {
      ...base,
      status: 'completed',
      completedAt: at,
      winnerId: 'a',
      confirmedVisits: [visit('v1', 'a', 101, 1, 100), visit('v2', 'a', 40, 0, 40, 'match_won')],
    };
    const events = matchTimeline(match);

    expect(events.map((event) => event.kind)).toEqual([
      'start',
      'visit',
      'high_score',
      'checkout_attempt',
      'lead_change',
      'visit',
      'checkout',
      'complete',
    ]);
    expect(events.at(-1)).toMatchObject({ kind: 'complete', playerId: 'a' });
  });
});
