import type { Match, Player, PlayerId } from "../../domain/match/models";
import { statisticsForMatch } from "../../domain/statistics/StatisticsCalculator";
import { victoryTitle } from "../players/victoryTitle";

export type SummaryViewModel = Readonly<{
  title: string;
  winner?: Readonly<{ playerId: PlayerId; name: string; temporary: boolean; position: number }>;
  facts: readonly Readonly<{ label: string; value: string }>[];
  maximums: number;
}>;

export function toSummaryViewModel(match: Match, players: readonly Player[]): SummaryViewModel {
  const saved = new Map(players.map((player) => [player.id, player]));
  const stats = statisticsForMatch(match);
  const winnerPosition = match.winnerId ? match.players.indexOf(match.winnerId) : -1;
  const winnerName = match.winnerId ? saved.get(match.winnerId)?.name ?? match.participantNames[match.winnerId] ?? "Игрок" : undefined;
  const winnerStats = match.winnerId ? stats[match.winnerId] : undefined;
  const bestVisit = Math.max(0, ...Object.values(stats).map((item) => item.bestVisit));
  const visits = match.confirmedVisits.length;
  const maximums = match.confirmedVisits.filter((visit) => visit.awardedScore === 180).length;
  const facts = [
    ...(winnerStats ? [{ label: "Средний набор победителя", value: winnerStats.averagePerVisit.toFixed(1) }] : []),
    { label: "Лучший подход матча", value: String(bestVisit) },
    { label: "Подходов сыграно", value: String(visits) },
  ].slice(0, 3);
  return {
    title: victoryTitle(winnerName),
    ...(match.winnerId && winnerName ? { winner: { playerId: match.winnerId, name: winnerName, temporary: !saved.has(match.winnerId), position: winnerPosition } } : {}),
    facts,
    maximums,
  };
}
