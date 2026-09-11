import type { Match, Player } from '../domain/match/models';
import { statisticsForMatch } from '../domain/statistics/StatisticsCalculator';

export type ResultShareCard = Readonly<{
  brand: 'Dart Scorekeeper';
  date: string;
  title: string;
  participants: readonly Readonly<{ name: string; result: number; winner: boolean }>[];
  facts: readonly Readonly<{ label: string; value: string }>[];
}>;

export function prepareResultShare(match: Match, players: readonly Player[]): ResultShareCard {
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
    })),
    facts: [
      { label: 'Лучший подход', value: `${best.score} · ${best.name}` },
      ...(winnerAverage !== undefined ? [{ label: 'Средний набор победителя', value: winnerAverage.toFixed(1) }] : []),
      ...(maximums > 0 ? [{ label: 'Максимумы 180', value: String(maximums) }] : []),
    ].slice(0, 3),
  };
}
