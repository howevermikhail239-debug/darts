import { scoreOf, bull, miss, numberThrow, outerBull } from '../darts/DartThrow';

const dartScores = new Set<number>([scoreOf(miss()), scoreOf(outerBull()), scoreOf(bull())]);
for (let segment = 1; segment <= 20; segment += 1) {
  dartScores.add(scoreOf(numberThrow(segment, 1)));
  dartScores.add(scoreOf(numberThrow(segment, 2)));
  dartScores.add(scoreOf(numberThrow(segment, 3)));
}
const scores = [...dartScores];
const reachable = new Set<number>();
for (const first of scores) for (const second of scores) for (const third of scores) reachable.add(first + second + third);

export const isReachableThreeDartScore = (score: number): boolean =>
  Number.isInteger(score) && score >= 0 && score <= 180 && reachable.has(score);
