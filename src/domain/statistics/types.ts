export type ThresholdKey = "60+" | "80+" | "100+" | "120+" | "140+" | "180";
export type DistributionKey = "0–19" | "20–39" | "40–59" | "60–79" | "80–99" | "100–119" | "120–139" | "140–179" | "180";
export type StatisticsMode = "all" | "x01" | "fixed_visits";
export type StatisticsPeriod = 5 | 10 | 20 | "all";

export type DartPositionStatistics = Readonly<{
  physicalDarts: number; points: number; average: number; misses: number;
  missPercent: number; triples: number; triplePercent: number;
}>;

export type PlayerStatistics = Readonly<{
  physicalDarts: number; knownHitDarts: number; visits: number; awardedPoints: number; rawPoints: number;
  averagePerDart: number; averagePerVisit: number; threeDartAverage: number; bestVisit: number;
  misses: number; outerBulls: number; bulls: number; singles: number; doubles: number; triples: number;
  hitCounts: Readonly<Record<string, number>>; positionScores: readonly [number, number, number];
  positions: readonly [DartPositionStatistics, DartPositionStatistics, DartPositionStatistics];
  thresholds: Readonly<Record<ThresholdKey, number>>; distribution: Readonly<Record<DistributionKey, number>>;
  resultSpread: number; winningHits: Readonly<Record<string, number>>; finishes: readonly number[];
}>;

export type PlayerHistoryStatistics = PlayerStatistics & Readonly<{
  completedGames: number; wins: number; losses: number; draws: number; winRate: number; matches: number;
}>;

export type PlayerRecords = Readonly<{
  bestVisit: number; bestThreeDartAverage: number; most100Plus: number; most140Plus: number;
  most180s: number; mostTriples: number; mostBulls: number; lowestMissPercent?: number;
}>;
export type RecordImprovement = Readonly<{ key: keyof PlayerRecords; label: string; value: number; previous: number; percent?: boolean }>;
export type TrendMetric = "threeDartAverage" | "bestVisit" | "missPercent" | "triplePercent" | "100Plus";
export type TrendPoint = Readonly<{ matchId: string; date: string; value: number }>;
export type HeadToHeadStatistics = Readonly<{ sharedMatches: number; playerAWins: number; playerBWins: number; otherPlayerWins: number }>;
