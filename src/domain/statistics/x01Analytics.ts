import { isDetailedVisit, type Match, type PlayerId } from '../match/models';
import { percentage, statisticsForVisits } from './visitStatistics';

export type X01Analytics = Readonly<{
  first9Average: number;
  checkoutAttempts: number;
  successfulCheckouts: number;
  checkoutPercent: number;
  highestCheckout: number;
  busts: number;
  bustRate: number;
  doubleAttempts: number;
  doubleHits: number;
  doubles: Readonly<Record<string, Readonly<{ attempts: number; hits: number }>>>;
  averageRemainingAfter: Readonly<Record<3 | 6 | 9 | 12 | 15, number | undefined>>;
}>;
const checkpoints = [3, 6, 9, 12, 15] as const;

/** X01-only metrics are reconstructed from confirmed visits; aggregate-input visits honestly omit double detail. */
export function x01Analytics(matches: readonly Match[], playerId: PlayerId): X01Analytics {
  const selected = matches.filter((match) => match.state.kind === 'x01' && match.players.includes(playerId));
  const visits = selected.flatMap((match) => match.confirmedVisits.filter((visit) => visit.playerId === playerId));
  const firstNine = selected.flatMap((match) =>
    match.confirmedVisits.filter((visit) => visit.playerId === playerId).slice(0, 3),
  );
  const checkoutVisits = visits.filter(
    (visit) => visit.before.scores[playerId] !== undefined && visit.before.scores[playerId]! <= 170,
  );
  const doubles: Record<string, { attempts: number; hits: number }> = {};
  let doubleAttempts = 0,
    doubleHits = 0;
  for (const visit of checkoutVisits) {
    if (!isDetailedVisit(visit)) continue;
    for (const dart of visit.darts) {
      const label =
        dart.kind === 'bull'
          ? 'Bull'
          : dart.kind === 'number' && dart.multiplier === 2
            ? `D${dart.segment}`
            : undefined;
      if (!label) continue;
      const entry = (doubles[label] ??= { attempts: 0, hits: 0 });
      entry.attempts += 1;
      doubleAttempts += 1;
      if (visit.result === 'match_won' && dart === visit.darts.at(-1)) {
        entry.hits += 1;
        doubleHits += 1;
      }
    }
  }
  const remaining: Record<number, number[]> = Object.fromEntries(checkpoints.map((point) => [point, []]));
  for (const match of selected) {
    const own = match.confirmedVisits.filter((visit) => visit.playerId === playerId);
    for (const point of checkpoints) {
      const visit = own[point - 1];
      const value = visit?.after.scores[playerId];
      if (value !== undefined) remaining[point]!.push(value);
    }
  }
  return {
    first9Average: statisticsForVisits(firstNine, playerId).threeDartAverage,
    checkoutAttempts: checkoutVisits.length,
    successfulCheckouts: checkoutVisits.filter((visit) => visit.result === 'match_won').length,
    checkoutPercent: percentage(
      checkoutVisits.filter((visit) => visit.result === 'match_won').length,
      checkoutVisits.length,
    ),
    highestCheckout: Math.max(
      0,
      ...checkoutVisits.filter((visit) => visit.result === 'match_won').map((visit) => visit.awardedScore),
    ),
    busts: visits.filter((visit) => visit.result === 'bust').length,
    bustRate: percentage(visits.filter((visit) => visit.result === 'bust').length, visits.length),
    doubleAttempts,
    doubleHits,
    doubles,
    averageRemainingAfter: Object.fromEntries(
      checkpoints.map((point) => [
        point,
        remaining[point]!.length ? remaining[point]!.reduce((a, b) => a + b, 0) / remaining[point]!.length : undefined,
      ]),
    ) as X01Analytics['averageRemainingAfter'],
  };
}
