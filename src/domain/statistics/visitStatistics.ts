import { notationOf, scoreOf } from "../darts/DartThrow";
import { isDetailedVisit, type Match, type PlayerId, type Visit } from "../match/models";
import type { DartPositionStatistics, DistributionKey, PlayerStatistics, ThresholdKey } from "./types";

export const distributionKeys: readonly DistributionKey[] = ["0–19", "20–39", "40–59", "60–79", "80–99", "100–119", "120–139", "140–179", "180"];
const thresholdKeys: readonly ThresholdKey[] = ["60+", "80+", "100+", "120+", "140+"];
const safeRatio = (numerator: number, denominator: number): number => denominator > 0 ? numerator / denominator : 0;
export const percentage = (part: number, whole: number): number => safeRatio(part, whole) * 100;
const emptyPosition = (): DartPositionStatistics => ({ physicalDarts: 0, points: 0, average: 0, misses: 0, missPercent: 0, triples: 0, triplePercent: 0 });

function distributionKey(score: number): DistributionKey {
  if (score >= 180) return "180";
  if (score >= 140) return "140–179";
  if (score >= 120) return "120–139";
  if (score >= 100) return "100–119";
  if (score >= 80) return "80–99";
  if (score >= 60) return "60–79";
  if (score >= 40) return "40–59";
  if (score >= 20) return "20–39";
  return "0–19";
}

export const standardDeviation = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
};

export function statisticsForVisits(visits: readonly Visit[], playerId: PlayerId): PlayerStatistics {
  const own = visits.filter((visit) => visit.playerId === playerId);
  const hitCounts: Record<string, number> = {}, winningHits: Record<string, number> = {};
  const positions = Array.from({ length: 3 }, emptyPosition);
  const thresholds: Record<ThresholdKey, number> = { "60+": 0, "80+": 0, "100+": 0, "120+": 0, "140+": 0, "180": 0 };
  const distribution = Object.fromEntries(distributionKeys.map((key) => [key, 0])) as Record<DistributionKey, number>;
  const finishes: number[] = [], scoringValues: number[] = [];
  // `physicalDarts` stays the honest count of darts actually thrown; `scoringDarts` is the
  // denominator of the scoring averages, where a bust costs the full visit of three darts —
  // otherwise busting earlier (a worse mistake) would improve the 3-dart average.
  let rawPoints = 0, physicalDarts = 0, scoringDarts = 0, knownHitDarts = 0, awardedPoints = 0, bestVisit = 0;
  let misses = 0, outerBulls = 0, bulls = 0, singles = 0, doubles = 0, triples = 0;

  for (const visit of own) {
    physicalDarts += visit.physicalDartsUsed;
    scoringDarts += visit.result === "bust" ? 3 : visit.physicalDartsUsed;
    rawPoints += visit.rawScore;
    awardedPoints += visit.awardedScore;
    const scoringValue = visit.awardedScore;
    bestVisit = Math.max(bestVisit, scoringValue);
    scoringValues.push(scoringValue);
    distribution[distributionKey(scoringValue)] += 1;
    for (const key of thresholdKeys) if (scoringValue >= Number(key.slice(0, -1))) thresholds[key] += 1;
    if (scoringValue === 180) thresholds["180"] += 1;

    if (isDetailedVisit(visit)) visit.darts.forEach((dart, index) => {
      knownHitDarts += 1;
      const label = notationOf(dart), points = scoreOf(dart), position = positions[index];
      hitCounts[label] = (hitCounts[label] ?? 0) + 1;
      if (position) positions[index] = { ...position, physicalDarts: position.physicalDarts + 1, points: position.points + points, misses: position.misses + (dart.kind === "miss" ? 1 : 0), triples: position.triples + (dart.kind === "number" && dart.multiplier === 3 ? 1 : 0) };
      if (dart.kind === "miss") misses += 1;
      else if (dart.kind === "outer_bull") outerBulls += 1;
      else if (dart.kind === "bull") bulls += 1;
      else if (dart.multiplier === 1) singles += 1;
      else if (dart.multiplier === 2) doubles += 1;
      else triples += 1;
    });
    if (visit.result === "match_won") {
      const last = isDetailedVisit(visit) ? visit.darts.at(-1) : undefined;
      if (last) { const label = notationOf(last); winningHits[label] = (winningHits[label] ?? 0) + 1; }
      finishes.push(visit.awardedScore);
    }
  }

  const completedPositions = positions.map((position) => ({ ...position, average: safeRatio(position.points, position.physicalDarts), missPercent: percentage(position.misses, position.physicalDarts), triplePercent: percentage(position.triples, position.physicalDarts) })) as [DartPositionStatistics, DartPositionStatistics, DartPositionStatistics];
  return { physicalDarts, knownHitDarts, visits: own.length, awardedPoints, rawPoints, averagePerDart: safeRatio(awardedPoints, scoringDarts), averagePerVisit: safeRatio(awardedPoints, own.length), threeDartAverage: safeRatio(awardedPoints * 3, scoringDarts), bestVisit, misses, outerBulls, bulls, singles, doubles, triples, hitCounts, positionScores: [completedPositions[0].points, completedPositions[1].points, completedPositions[2].points], positions: completedPositions, thresholds, distribution, resultSpread: standardDeviation(scoringValues), winningHits, finishes };
}

export const statisticsForMatch = (match: Match): Readonly<Record<PlayerId, PlayerStatistics>> => Object.fromEntries(match.players.map((id) => [id, statisticsForVisits(match.confirmedVisits, id)]));
