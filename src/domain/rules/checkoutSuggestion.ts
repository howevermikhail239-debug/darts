import { bull, isDouble, numberThrow, notationOf, outerBull, scoreOf, type DartThrow } from '../darts/DartThrow';
import type { OutRule } from '../match/models';

const singles: readonly DartThrow[] = Array.from({ length: 20 }, (_, index) => numberThrow(20 - index, 1));
const doubles: readonly DartThrow[] = [bull(), ...Array.from({ length: 20 }, (_, index) => numberThrow(20 - index, 2))];
const triples: readonly DartThrow[] = Array.from({ length: 20 }, (_, index) => numberThrow(20 - index, 3));
const scoring: readonly DartThrow[] = [...singles, ...doubles, ...triples, outerBull()];

const standardRoutes: Readonly<Record<number, string>> = {
  170: 'T20 · T20 · Bull',
  167: 'T20 · T19 · Bull',
  164: 'T20 · T18 · Bull',
  161: 'T20 · T17 · Bull',
  160: 'T20 · T20 · D20',
  121: 'T20 · T11 · D14',
  100: 'T20 · D20',
  80: 'T20 · D10',
  50: 'S10 · D20',
  40: 'D20',
  32: 'D16',
};
const doublePreference = [16, 20, 18, 12, 10, 8, 4, 6, 14, 2, 1, 5, 9, 13, 17, 19, 15, 11, 7, 3];
const bogeys = new Set([169, 168, 166, 165, 163, 162, 159]);

const routeText = (route: readonly DartThrow[]) => route.map(notationOf).join(' · ');
const isMasterFinish = (dart: DartThrow): boolean =>
  isDouble(dart) || (dart.kind === 'number' && dart.multiplier === 3);
const isFinish = (dart: DartThrow, outRule: OutRule): boolean =>
  outRule === 'straight' || (outRule === 'double' ? isDouble(dart) : isMasterFinish(dart));

const dartDifficulty = (dart: DartThrow): number => {
  if (dart.kind === 'outer_bull') return 5.2;
  if (dart.kind === 'bull') return 6.4;
  if (dart.kind === 'miss') return Number.POSITIVE_INFINITY;
  if (dart.multiplier === 1) return 1;
  if (dart.multiplier === 2) return 3.5 + doublePreference.indexOf(dart.segment) * 0.025;
  return 4.8 + (dart.segment < 15 ? 0.8 : 0);
};

/** Lower scores are easier for an average player. Validity is deliberately handled elsewhere. */
export function rankCheckoutRoute(route: readonly DartThrow[], score: number, outRule: OutRule): number {
  let rank = route.length * 0.8 + route.reduce((sum, dart) => sum + dartDifficulty(dart), 0);
  if (outRule === 'straight') {
    const finish = route.at(-1)!;
    if (finish.kind === 'number' && finish.multiplier === 1) rank -= 1.6;
    else if (finish.kind === 'number' && finish.multiplier === 3) rank += 1.2;
    else if (finish.kind === 'bull' || finish.kind === 'outer_bull') rank += 0.8;
  }

  let remaining = score;
  for (const [index, dart] of route.slice(0, -1).entries()) {
    remaining -= scoreOf(dart);
    // When two equally easy routes use the same darts, take the larger score first. A miss then
    // leaves the more familiar low checkout rather than forcing the difficult dart later.
    rank -= scoreOf(dart) * (route.length - index) * 0.002;
    if (outRule !== 'straight') {
      if (remaining <= 40 && remaining % 2 === 0) rank -= 0.65;
      if (remaining <= 40 && remaining % 2 === 1) rank += 1.1;
      if (bogeys.has(remaining)) rank += 2.5;
    }
  }
  if (outRule !== 'straight' && standardRoutes[score] === routeText(route)) rank -= 5;
  return rank;
}

function candidates(score: number, dartsRemaining: number, outRule: OutRule): readonly (readonly DartThrow[])[] {
  const routes: DartThrow[][] = [];
  const search = (remaining: number, dartsLeft: number, route: readonly DartThrow[]) => {
    for (const dart of scoring) {
      const next = remaining - scoreOf(dart);
      if (next < 0) continue;
      if (next === 0) {
        if (isFinish(dart, outRule)) routes.push([...route, dart]);
        continue;
      }
      if (dartsLeft === 1 || (outRule !== 'straight' && next === 1)) continue;
      search(next, dartsLeft - 1, [...route, dart]);
    }
  };
  search(score, Math.min(3, dartsRemaining), []);
  return routes;
}

const suggestionCache = new Map<string, readonly DartThrow[] | undefined>();

export function checkoutSuggestion(
  score: number,
  dartsRemaining: number,
  outRule: OutRule,
): readonly DartThrow[] | undefined {
  if (score < 1 || dartsRemaining < 1) return undefined;
  const key = `${score}:${Math.min(3, dartsRemaining)}:${outRule}`;
  if (suggestionCache.has(key)) return suggestionCache.get(key);
  const result = [...candidates(score, dartsRemaining, outRule)].sort((a, b) => {
    const difference = rankCheckoutRoute(a, score, outRule) - rankCheckoutRoute(b, score, outRule);
    return difference || routeText(a).localeCompare(routeText(b), 'en');
  })[0];
  suggestionCache.set(key, result);
  return result;
}

export const checkoutText = routeText;
