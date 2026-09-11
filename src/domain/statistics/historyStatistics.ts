import type { Match, PlayerId } from '../match/models';
import { percentage, statisticsForVisits } from './visitStatistics';
import type {
  HeadToHeadStatistics,
  PlayerHistoryStatistics,
  PlayerRecords,
  RecordImprovement,
  StatisticsMode,
  StatisticsPeriod,
  TrendMetric,
  TrendPoint,
} from './types';

export const MIN_PERCENT_RECORD_DARTS = 15;
const chronological = (matches: readonly Match[]): readonly Match[] =>
  [...matches].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
const afterReset = (match: Match, statsResetAt?: string): boolean => !statsResetAt || match.createdAt >= statsResetAt;
const matchesForPlayerAndMode = (
  matches: readonly Match[],
  playerId: PlayerId,
  mode: StatisticsMode,
  statsResetAt?: string,
): readonly Match[] =>
  chronological(matches).filter(
    (match) =>
      match.players.includes(playerId) &&
      afterReset(match, statsResetAt) &&
      (mode === 'all' || match.state.kind === mode),
  );
const applyPeriod = (matches: readonly Match[], period: StatisticsPeriod): readonly Match[] =>
  period === 'all' ? matches : matches.slice(-period);

export function filteredMatches(
  matches: readonly Match[],
  playerId: PlayerId,
  mode: StatisticsMode,
  period: StatisticsPeriod,
  statsResetAt?: string,
): readonly Match[] {
  return applyPeriod(matchesForPlayerAndMode(matches, playerId, mode, statsResetAt), period);
}

function completedMatches(
  matches: readonly Match[],
  playerId: PlayerId,
  mode: StatisticsMode,
  period: StatisticsPeriod,
  statsResetAt?: string,
): readonly Match[] {
  return applyPeriod(
    matchesForPlayerAndMode(matches, playerId, mode, statsResetAt).filter((match) => match.status === 'completed'),
    period,
  );
}

export function statisticsForPlayerHistory(
  matches: readonly Match[],
  playerId: PlayerId,
  mode: StatisticsMode = 'all',
  period: StatisticsPeriod = 'all',
  statsResetAt?: string,
): PlayerHistoryStatistics {
  const selected = filteredMatches(matches, playerId, mode, period, statsResetAt);
  const base = statisticsForVisits(
    selected.flatMap((match) => match.confirmedVisits),
    playerId,
  );
  const decided = selected.filter((match) => match.status === 'completed' && match.winnerId !== undefined);
  const wins = decided.filter((match) => match.winnerId === playerId).length;
  const completed = selected.filter((match) => match.status === 'completed');
  return {
    ...base,
    matches: selected.length,
    completedGames: completed.length,
    wins,
    losses: decided.length - wins,
    draws: completed.length - decided.length,
    winRate: percentage(wins, decided.length),
  };
}

export function recordsForPlayer(
  matches: readonly Match[],
  playerId: PlayerId,
  mode: StatisticsMode = 'all',
  statsResetAt?: string,
): PlayerRecords {
  const perMatch = completedMatches(matches, playerId, mode, 'all', statsResetAt).map((match) =>
    statisticsForVisits(match.confirmedVisits, playerId),
  );
  const missRates = perMatch
    .filter((stats) => stats.knownHitDarts >= MIN_PERCENT_RECORD_DARTS)
    .map((stats) => percentage(stats.misses, stats.knownHitDarts));
  return {
    bestVisit: Math.max(0, ...perMatch.map((stats) => stats.bestVisit)),
    bestThreeDartAverage: Math.max(0, ...perMatch.map((stats) => stats.threeDartAverage)),
    most100Plus: Math.max(0, ...perMatch.map((stats) => stats.thresholds['100+'])),
    most140Plus: Math.max(0, ...perMatch.map((stats) => stats.thresholds['140+'])),
    most180s: Math.max(0, ...perMatch.map((stats) => stats.thresholds['180'])),
    mostTriples: Math.max(0, ...perMatch.map((stats) => stats.triples)),
    mostBulls: Math.max(0, ...perMatch.map((stats) => stats.bulls)),
    ...(missRates.length ? { lowestMissPercent: Math.min(...missRates) } : {}),
  };
}

const recordLabels: Record<keyof PlayerRecords, string> = {
  bestVisit: 'Лучший подход',
  bestThreeDartAverage: 'Лучшее среднее за 3 дротика',
  most100Plus: 'Больше всего 100+ за матч',
  most140Plus: 'Больше всего 140+ за матч',
  most180s: 'Больше всего 180 за матч',
  mostTriples: 'Больше всего утроений за матч',
  mostBulls: 'Больше всего Bull за матч',
  lowestMissPercent: 'Минимальная доля промахов',
};

export function newRecordsForMatch(
  current: Match,
  previousMatches: readonly Match[],
  playerId: PlayerId,
  statsResetAt?: string,
): readonly RecordImprovement[] {
  if (current.status !== 'completed') return [];
  const prior = previousMatches.filter(
    (match) =>
      match.id !== current.id &&
      match.status === 'completed' &&
      match.players.includes(playerId) &&
      afterReset(match, statsResetAt),
  );
  if (!prior.length) return [];
  const before = recordsForPlayer(prior, playerId),
    stats = statisticsForVisits(current.confirmedVisits, playerId);
  const currentRecords: PlayerRecords = {
    bestVisit: stats.bestVisit,
    bestThreeDartAverage: stats.threeDartAverage,
    most100Plus: stats.thresholds['100+'],
    most140Plus: stats.thresholds['140+'],
    most180s: stats.thresholds['180'],
    mostTriples: stats.triples,
    mostBulls: stats.bulls,
    ...(stats.knownHitDarts >= MIN_PERCENT_RECORD_DARTS
      ? { lowestMissPercent: percentage(stats.misses, stats.knownHitDarts) }
      : {}),
  };
  return (Object.keys(currentRecords) as (keyof PlayerRecords)[]).flatMap((key) => {
    const value = currentRecords[key],
      previous = before[key];
    if (value === undefined || previous === undefined) return [];
    const improved = key === 'lowestMissPercent' ? value < previous : value > previous;
    return improved
      ? [{ key, label: recordLabels[key], value, previous, ...(key === 'lowestMissPercent' ? { percent: true } : {}) }]
      : [];
  });
}

export function trendForPlayer(
  matches: readonly Match[],
  playerId: PlayerId,
  metric: TrendMetric,
  mode: StatisticsMode = 'all',
  period: StatisticsPeriod = 'all',
  statsResetAt?: string,
): readonly TrendPoint[] {
  return completedMatches(matches, playerId, mode, period, statsResetAt).map((match) => {
    const stats = statisticsForVisits(match.confirmedVisits, playerId);
    const values: Record<TrendMetric, number> = {
      threeDartAverage: stats.threeDartAverage,
      bestVisit: stats.bestVisit,
      missPercent: percentage(stats.misses, stats.knownHitDarts),
      triplePercent: percentage(stats.triples, stats.knownHitDarts),
      '100Plus': stats.thresholds['100+'],
    };
    return { matchId: match.id, date: match.completedAt ?? match.createdAt, value: values[metric] };
  });
}

export function headToHead(
  matches: readonly Match[],
  playerA: PlayerId,
  playerB: PlayerId,
  mode: StatisticsMode = 'all',
  statsResetAt?: string,
): HeadToHeadStatistics {
  const shared = matches.filter(
    (match) =>
      match.status === 'completed' &&
      match.players.includes(playerA) &&
      match.players.includes(playerB) &&
      afterReset(match, statsResetAt) &&
      (mode === 'all' || match.state.kind === mode),
  );
  return {
    sharedMatches: shared.length,
    playerAWins: shared.filter((match) => match.winnerId === playerA).length,
    playerBWins: shared.filter((match) => match.winnerId === playerB).length,
    otherPlayerWins: shared.filter(
      (match) =>
        match.winnerId !== undefined && match.winnerId && match.winnerId !== playerA && match.winnerId !== playerB,
    ).length,
  };
}
