import { describe, expect, it } from "vitest";
import { bull, miss, numberThrow, outerBull, scoreOf, type DartThrow } from "../src/domain/darts/DartThrow";
import { createMatch } from "../src/domain/match/createMatch";
import type { Match, PlayerId, Visit, VisitResult } from "../src/domain/match/models";
import { MIN_PERCENT_RECORD_DARTS, filteredMatches, headToHead, newRecordsForMatch, recordsForPlayer, standardDeviation, statisticsForPlayerHistory, statisticsForVisits, trendForPlayer } from "../src/domain/statistics/StatisticsCalculator";

const at = (day: number) => `2026-01-${String(day).padStart(2, "0")}T12:00:00.000Z`;
function visit(id: string, playerId: PlayerId, darts: readonly DartThrow[], options: { awarded?: number; result?: VisitResult } = {}): Visit {
  const rawScore = darts.reduce((sum, dart) => sum + scoreOf(dart), 0);
  return { id, matchId: "match", playerId, visitIndex: Number(id.replace(/\D/g, "")) || 0, darts, physicalDartsUsed: darts.length, rawScore, awardedScore: options.awarded ?? rawScore, before: { scores: { a: 501, b: 501, c: 501 }, currentPlayerIndex: 0 }, after: { scores: { a: 501, b: 501, c: 501 }, currentPlayerIndex: 1 }, result: options.result ?? "scored", timestamp: at(1) };
}
function match(id: string, day: number, mode: "x01" | "fixed_visits", visits: readonly Visit[], winnerId?: string, players: readonly string[] = ["a", "b"], status: Match["status"] = "completed"): Match {
  const base = createMatch(id, players, mode === "x01" ? { mode, format: { kind: "unlimited" }, startingPlayerIndex: 0 } : { mode, visitsPerPlayer: 1, startingPlayerIndex: 0 }, at(day));
  return { ...base, id, createdAt: at(day), ...(status === "completed" ? { completedAt: at(day) } : {}), status, confirmedVisits: visits.map((item) => ({ ...item, matchId: id })), ...(winnerId ? { winnerId } : {}) };
}

describe("statistics projections", () => {
  it("counts physical hits, exact sectors, positions and early finish without invented misses", () => {
    const visits = [
      visit("v1", "a", [numberThrow(1, 1), numberThrow(10, 2), numberThrow(20, 3)]),
      visit("v2", "a", [outerBull(), bull(), miss()]),
      visit("v3", "a", [numberThrow(20, 3)], { result: "match_won" }),
    ];
    const stats = statisticsForVisits(visits, "a");
    expect(stats).toMatchObject({ physicalDarts: 7, visits: 3, singles: 1, doubles: 1, triples: 2, outerBulls: 1, bulls: 1, misses: 1, rawPoints: 216, awardedPoints: 216, bestVisit: 81 });
    expect(stats.hitCounts).toMatchObject({ S1: 1, D10: 1, T20: 2, "25": 1, Bull: 1, MISS: 1 });
    expect(stats.positions.map((position) => position.physicalDarts)).toEqual([3, 2, 2]);
    expect(stats.positions[0].average).toBeCloseTo(86 / 3);
    expect(stats.positions[2]).toMatchObject({ missPercent: 50, triplePercent: 50 });
    expect(stats.averagePerVisit).toBe(72);
    expect(stats.threeDartAverage).toBeCloseTo(216 * 3 / 7);
  });

  it("uses cumulative thresholds, exact buckets and a transparent standard deviation", () => {
    const scores = [0, 20, 40, 60, 80, 100, 120, 140, 180];
    const visits = scores.map((score, index) => visit(`v${index}`, "a", score === 0 ? [miss()] : score === 180 ? [numberThrow(20, 3), numberThrow(20, 3), numberThrow(20, 3)] : [numberThrow(Math.min(20, score), 1)], { awarded: score }));
    // The explicit score is what a confirmed visit stores; physical darts remain real facts.
    const confirmed = visits.map((item, index) => ({ ...item, rawScore: scores[index]!, awardedScore: scores[index]! }));
    const stats = statisticsForVisits(confirmed, "a");
    expect(stats.thresholds).toEqual({ "60+": 6, "80+": 5, "100+": 4, "120+": 3, "140+": 2, "180": 1 });
    expect(Object.values(stats.distribution)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(stats.resultSpread).toBeCloseTo(standardDeviation(scores));
  });

  it("keeps bust hits raw while awarded scoring remains zero", () => {
    const stats = statisticsForVisits([visit("v1", "a", [numberThrow(20, 3)], { awarded: 0, result: "bust" })], "a");
    expect(stats).toMatchObject({ physicalDarts: 1, rawPoints: 60, awardedPoints: 0, averagePerDart: 0, bestVisit: 0, triples: 1 });
    expect(stats.hitCounts.T20).toBe(1);
    expect(stats.thresholds["60+"]).toBe(0);
    expect(stats.distribution["0–19"]).toBe(1);
  });

  it("keeps bust 140 and 180 as raw hits without creating scoring achievements", () => {
    const stats = statisticsForVisits([
      visit("v1", "a", [numberThrow(20, 3), numberThrow(20, 3), numberThrow(20, 1)], { awarded: 0, result: "bust" }),
      visit("v2", "a", [numberThrow(20, 3), numberThrow(20, 3), numberThrow(20, 3)], { awarded: 0, result: "bust" }),
    ], "a");
    expect(stats).toMatchObject({ physicalDarts: 6, rawPoints: 320, awardedPoints: 0, bestVisit: 0, triples: 5 });
    expect(stats.hitCounts.T20).toBe(5);
    expect(stats.hitCounts.S20).toBe(1);
    expect(stats.thresholds).toEqual({ "60+": 0, "80+": 0, "100+": 0, "120+": 0, "140+": 0, "180": 0 });
    expect(stats.distribution["0–19"]).toBe(2);
    expect(stats.resultSpread).toBe(0);
  });

  it("returns finite zeroes with no physical darts", () => {
    const stats = statisticsForVisits([], "a");
    expect([stats.averagePerDart, stats.averagePerVisit, stats.threeDartAverage, stats.resultSpread, ...stats.positions.flatMap((position) => [position.average, position.missPercent, position.triplePercent])].every(Number.isFinite)).toBe(true);
  });

  it("excludes abandoned matches from win rate but retains their confirmed darts", () => {
    const won = match("won", 1, "x01", [visit("v1", "a", [numberThrow(20, 3)])], "a");
    const lost = match("lost", 2, "x01", [visit("v2", "a", [numberThrow(20, 1)])], "b");
    const abandoned = match("abandoned", 3, "x01", [visit("v3", "a", [miss()])], undefined, ["a", "b"], "abandoned");
    const stats = statisticsForPlayerHistory([won, lost, abandoned], "a");
    expect(stats).toMatchObject({ matches: 3, completedGames: 2, wins: 1, losses: 1, winRate: 50, physicalDarts: 3, misses: 1 });
  });

  it("includes abandoned hits in overall statistics but excludes them from records and trends", () => {
    const abandoned = match("abandoned", 1, "x01", [visit("v1", "a", [numberThrow(20, 3), numberThrow(20, 3), numberThrow(20, 3)])], undefined, ["a", "b"], "abandoned");
    const completed = match("completed", 2, "x01", [visit("v2", "a", [numberThrow(20, 1)])], "a");
    const overall = statisticsForPlayerHistory([abandoned, completed], "a");
    expect(overall).toMatchObject({ physicalDarts: 4, rawPoints: 200, triples: 3, wins: 1, losses: 0, winRate: 100 });
    expect(recordsForPlayer([abandoned, completed], "a")).toMatchObject({ bestVisit: 20, most180s: 0, mostTriples: 0 });
    expect(trendForPlayer([abandoned, completed], "a", "bestVisit")).toEqual([{ matchId: "completed", date: at(2), value: 20 }]);
    expect(newRecordsForMatch(abandoned, [completed], "a")).toEqual([]);
  });

  it("uses only earlier completed matches as the baseline for record improvements", () => {
    const abandoned = match("abandoned", 1, "x01", [visit("v1", "a", [numberThrow(20, 3), numberThrow(20, 3), numberThrow(20, 3)])], undefined, ["a", "b"], "abandoned");
    const baseline = match("baseline", 2, "x01", [visit("v2", "a", [numberThrow(20, 1)])], "a");
    const improved = match("improved", 3, "x01", [visit("v3", "a", [numberThrow(20, 3), numberThrow(20, 1)])], "a");
    expect(newRecordsForMatch(improved, [abandoned, baseline], "a").map((record) => record.key)).toEqual(expect.arrayContaining(["bestVisit", "bestThreeDartAverage", "mostTriples"]));
  });

  it("filters mode and last 5/10/20 without changing chronological trend order", () => {
    const matches = Array.from({ length: 24 }, (_, index) => match(`m${index}`, index + 1, index % 2 ? "x01" : "fixed_visits", [visit(`v${index}`, "a", [numberThrow(1, 1)])], "a"));
    expect(filteredMatches(matches, "a", "x01", 5)).toHaveLength(5);
    expect(statisticsForPlayerHistory(matches, "a", "fixed_visits", 10).matches).toBe(10);
    expect(filteredMatches(matches, "a", "all", 20)).toHaveLength(20);
    expect(trendForPlayer(matches, "a", "bestVisit", "x01", 5).map((point) => point.matchId)).toEqual(["m15", "m17", "m19", "m21", "m23"]);
  });

  it("calculates records and applies the named percentage minimum sample", () => {
    const tooShort = match("short", 1, "x01", [visit("v1", "a", [numberThrow(20, 3)])], "a");
    const enoughDarts = Array.from({ length: MIN_PERCENT_RECORD_DARTS / 3 }, (_, index) => visit(`e${index}`, "a", [miss(), numberThrow(20, 3), numberThrow(20, 3)]));
    const records = recordsForPlayer([tooShort, match("enough", 2, "x01", enoughDarts, "a")], "a");
    expect(records).toMatchObject({ bestVisit: 120, mostTriples: 10 });
    expect(records.lowestMissPercent).toBeCloseTo(100 / 3);
  });

  it("does not celebrate the first baseline match and detects a later real record", () => {
    const first = match("first", 1, "x01", [visit("v1", "a", [numberThrow(20, 1)])], "a");
    const better = match("better", 2, "x01", [visit("v2", "a", [numberThrow(20, 3), numberThrow(20, 3)])], "a");
    expect(newRecordsForMatch(first, [], "a")).toEqual([]);
    expect(newRecordsForMatch(better, [first], "a").map((record) => record.key)).toEqual(expect.arrayContaining(["bestVisit", "bestThreeDartAverage", "mostTriples", "most100Plus"]));
  });

  it("counts multiplayer head-to-head without turning a third-player win into a duel win", () => {
    const shared = [match("a", 1, "x01", [], "a", ["a", "b", "c"]), match("b", 2, "fixed_visits", [], "b", ["a", "b", "c"]), match("c", 3, "x01", [], "c", ["a", "b", "c"])];
    expect(headToHead(shared, "a", "b")).toEqual({ sharedMatches: 3, playerAWins: 1, playerBWins: 1, otherPlayerWins: 1 });
    expect(headToHead(shared, "a", "b", "x01")).toEqual({ sharedMatches: 2, playerAWins: 1, playerBWins: 0, otherPlayerWins: 1 });
  });
});
