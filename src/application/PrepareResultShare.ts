import type { Match, Player } from '../domain/match/models';
import { statisticsForMatch } from '../domain/statistics/StatisticsCalculator';
import { ratingsForMatches } from '../domain/competitive/rating';
import { x01Analytics } from '../domain/statistics/x01Analytics';

export type ResultShareCard = Readonly<{
  brand: 'Dart Scorekeeper';
  date: string;
  title: string;
  participants: readonly Readonly<{
    name: string;
    result: number;
    winner: boolean;
    average: number;
    rating?: string;
  }>[];
  facts: readonly Readonly<{ label: string; value: string }>[];
}>;

export function prepareResultShare(
  match: Match,
  players: readonly Player[],
  previousMatches: readonly Match[] = [],
  sessionTitle?: string,
): ResultShareCard {
  if (match.status !== 'completed') throw new Error('Поделиться можно только завершённым матчем');
  const names = new Map(players.map((player) => [player.id, player.name]));
  const stats = statisticsForMatch(match);
  const nameOf = (id: string) => names.get(id) ?? match.participantNames[id] ?? 'Игрок';
  const best = match.players.reduce(
    (current, id) =>
      (stats[id]?.bestVisit ?? 0) > current.score ? { score: stats[id]?.bestVisit ?? 0, name: nameOf(id) } : current,
    { score: 0, name: '—' },
  );
  const maximums = match.confirmedVisits.filter((visit) => visit.awardedScore === 180).length;
  const winnerName = match.winnerId ? nameOf(match.winnerId) : undefined;
  const winnerAverage = match.winnerId ? stats[match.winnerId]?.averagePerVisit : undefined;
  const ids = players.map((player) => player.id);
  const before = ratingsForMatches(previousMatches, ids);
  const after = ratingsForMatches([...previousMatches, match], ids);
  const checkout = match.state.kind === 'x01' && match.winnerId ? x01Analytics([match], match.winnerId) : undefined;
  return {
    brand: 'Dart Scorekeeper',
    date: new Date(match.completedAt ?? match.createdAt).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
    title: winnerName ? `${winnerName} побеждает` : 'Ничья',
    participants: match.players.map((id) => ({
      name: nameOf(id),
      result: match.state.kind === 'x01' ? (match.state.remaining[id] ?? 0) : (match.state.totals[id] ?? 0),
      winner: id === match.winnerId,
      average: stats[id]?.threeDartAverage ?? 0,
      ...(before.has(id) && after.has(id)
        ? {
            rating: `${before.get(id)!.rating} → ${after.get(id)!.rating} (${after.get(id)!.rating - before.get(id)!.rating >= 0 ? '+' : ''}${after.get(id)!.rating - before.get(id)!.rating})`,
          }
        : {}),
    })),
    facts: [
      { label: 'Лучший подход', value: `${best.score} · ${best.name}` },
      ...(winnerAverage !== undefined ? [{ label: 'Средний набор победителя', value: winnerAverage.toFixed(1) }] : []),
      ...(maximums > 0 ? [{ label: 'Максимумы 180', value: String(maximums) }] : []),
      ...(checkout?.highestCheckout ? [{ label: 'Лучший checkout', value: String(checkout.highestCheckout) }] : []),
      ...(checkout?.checkoutAttempts
        ? [{ label: 'Checkout', value: `${checkout.successfulCheckouts} / ${checkout.checkoutAttempts}` }]
        : []),
      ...(sessionTitle ? [{ label: 'Сессия', value: sessionTitle }] : []),
    ].slice(0, 3),
  };
}
