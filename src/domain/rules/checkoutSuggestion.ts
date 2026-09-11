import { bull, numberThrow, notationOf, outerBull, scoreOf, type DartThrow } from "../darts/DartThrow";

const doubles: readonly DartThrow[] = [bull(), ...Array.from({ length: 20 }, (_, index) => numberThrow(20 - index, 2))];
const scoring: readonly DartThrow[] = [
  ...Array.from({ length: 20 }, (_, index) => numberThrow(20 - index, 3)),
  ...doubles,
  ...Array.from({ length: 20 }, (_, index) => numberThrow(20 - index, 1)),
  // The outer bull is the only way to score exactly 25 with one dart; it is last so that it never
  // displaces an already preferred route and only fills routes that had no suggestion at all.
  outerBull(),
];
const preferred: Readonly<Record<number, readonly DartThrow[]>> = {
  170: [numberThrow(20, 3), numberThrow(20, 3), bull()], 167: [numberThrow(20, 3), numberThrow(19, 3), bull()],
  164: [numberThrow(20, 3), numberThrow(18, 3), bull()], 161: [numberThrow(20, 3), numberThrow(17, 3), bull()],
  160: [numberThrow(20, 3), numberThrow(20, 3), numberThrow(20, 2)], 121: [numberThrow(20, 3), numberThrow(11, 3), numberThrow(14, 2)],
  100: [numberThrow(20, 3), numberThrow(20, 2)], 80: [numberThrow(20, 3), numberThrow(10, 2)],
  40: [numberThrow(20, 2)], 32: [numberThrow(16, 2)],
};

export function checkoutSuggestion(score: number, dartsRemaining: number, outRule: "straight" | "double"): readonly DartThrow[] | undefined {
  if (score < 1 || dartsRemaining < 1) return undefined;
  const known = preferred[score]; if (known && known.length <= dartsRemaining) return known;
  const finishes = outRule === "double" ? doubles : scoring;
  const search = (remaining: number, darts: number, route: readonly DartThrow[]): readonly DartThrow[] | undefined => {
    if (darts === 1) { const finish = finishes.find((dart) => scoreOf(dart) === remaining); return finish ? [...route, finish] : undefined; }
    for (const dart of scoring) { const next = remaining - scoreOf(dart); if (next < 2) continue; const found = search(next, darts - 1, [...route, dart]); if (found) return found; }
    return undefined;
  };
  for (let count = 1; count <= Math.min(3, dartsRemaining); count += 1) { const result = search(score, count, []); if (result) return result; }
  return undefined;
}

export const checkoutText = (route: readonly DartThrow[]): string => route.map(notationOf).join(" · ");
