import type { Match, PlayerId } from "../match/models";
import { statisticsForMatch } from "./StatisticsCalculator";

export type TodaySummary = Readonly<{
  completedMatches: number;
  leader?: Readonly<{ name: string; wins: number; tied: boolean }>;
  bestVisit?: Readonly<{ name: string; score: number }>;
  maximums: number;
}>;

const localDay = (value: Date): string =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;

export function summarizeToday(
  matches: readonly Match[],
  persistentPlayerIds: readonly PlayerId[],
  now: Date,
): TodaySummary | undefined {
  const today = localDay(now);
  const completed = matches.filter((match) =>
    match.status === "completed" && localDay(new Date(match.completedAt ?? match.createdAt)) === today);
  if (completed.length === 0) return undefined;

  const persistent = new Set(persistentPlayerIds);
  const wins = new Map<PlayerId, number>();
  let bestVisit: TodaySummary["bestVisit"];
  let maximums = 0;
  for (const match of completed) {
    if (match.winnerId && persistent.has(match.winnerId))
      wins.set(match.winnerId, (wins.get(match.winnerId) ?? 0) + 1);
    const stats = statisticsForMatch(match);
    for (const playerId of match.players) {
      const score = stats[playerId]?.bestVisit ?? 0;
      if (!bestVisit || score > bestVisit.score)
        bestVisit = { name: match.participantNames[playerId] ?? "Игрок", score };
    }
    maximums += match.confirmedVisits.filter((visit) => visit.awardedScore === 180).length;
  }

  const top = Math.max(0, ...wins.values());
  const leaders = top > 0 ? [...wins.entries()].filter(([, count]) => count === top) : [];
  const leaderId = leaders[0]?.[0];
  const leaderMatch = leaderId ? completed.find((match) => match.players.includes(leaderId)) : undefined;
  return {
    completedMatches: completed.length,
    ...(leaderId && leaderMatch ? { leader: { name: leaderMatch.participantNames[leaderId] ?? "Игрок", wins: top, tied: leaders.length > 1 } } : {}),
    ...(bestVisit ? { bestVisit } : {}),
    maximums,
  };
}

export type RecentResult = "win" | "loss" | "draw";

export function recentForm(matches: readonly Match[], playerId: PlayerId, limit = 5, statsResetAt?: string): readonly RecentResult[] {
  return matches
    .filter((match) => match.status === "completed" && match.players.includes(playerId) && (!statsResetAt || match.createdAt >= statsResetAt))
    .sort((a, b) => (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt))
    .slice(0, limit)
    .map((match) => match.winnerId === undefined ? "draw" : match.winnerId === playerId ? "win" : "loss");
}

export type CurrentStreak = Readonly<{ result: RecentResult; count: number }>;
export function currentStreak(matches: readonly Match[], playerId: PlayerId, statsResetAt?: string): CurrentStreak | undefined {
  const form = recentForm(matches, playerId, Number.MAX_SAFE_INTEGER, statsResetAt);
  const result = form[0]; if (!result) return undefined;
  return { result, count: form.findIndex((item) => item !== result) < 0 ? form.length : form.findIndex((item) => item !== result) };
}
