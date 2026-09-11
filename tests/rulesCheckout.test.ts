import { describe, expect, it } from "vitest";
import { bull, isDouble, numberThrow, outerBull, scoreOf, type DartThrow } from "../src/domain/darts/DartThrow";
import { checkoutSuggestion } from "../src/domain/rules/checkoutSuggestion";

/** Every dart that can actually score, used as an independent reference solver. */
const allDarts: readonly DartThrow[] = [
  ...Array.from({ length: 20 }, (_, index) => numberThrow(index + 1, 1)),
  ...Array.from({ length: 20 }, (_, index) => numberThrow(index + 1, 2)),
  ...Array.from({ length: 20 }, (_, index) => numberThrow(index + 1, 3)),
  outerBull(),
  bull(),
];

const reachable = (score: number, darts: number, outRule: "straight" | "double"): boolean => {
  if (score < 1 || darts < 1) return false;
  const finishers = outRule === "double" ? allDarts.filter(isDouble) : allDarts;
  const search = (remaining: number, left: number): boolean => {
    if (left === 1) return finishers.some((dart) => scoreOf(dart) === remaining);
    return allDarts.some((dart) => {
      const next = remaining - scoreOf(dart);
      return next >= 1 && search(next, left - 1);
    }) || search(remaining, left - 1);
  };
  return search(score, darts);
};

type Gap = Readonly<{ score: number; darts: number; outRule: string }>;

describe("checkout suggestions (DOM-8)", () => {
  it("suggests the outer bull as a one-dart straight finish for 25", () => {
    expect(checkoutSuggestion(25, 1, "straight")?.map((dart) => dart.kind)).toEqual(["outer_bull"]);
    expect(checkoutSuggestion(25, 1, "double")).toBeUndefined();
  });

  it("matches a reference solver over every score, dart count and rule", () => {
    const missing: Gap[] = [], invalid: Gap[] = [], surplus: Gap[] = [];
    for (const outRule of ["straight", "double"] as const)
      for (let score = 1; score <= 180; score += 1)
        for (let darts = 1; darts <= 3; darts += 1) {
          const route = checkoutSuggestion(score, darts, outRule);
          const possible = reachable(score, darts, outRule);
          if (!route) { if (possible) missing.push({ score, darts, outRule }); continue; }
          if (!possible) surplus.push({ score, darts, outRule });
          const sum = route.reduce((total, dart) => total + scoreOf(dart), 0);
          const last = route.at(-1)!;
          if (sum !== score || route.length > darts || (outRule === "double" && !isDouble(last)) || route.some((dart) => dart.kind === "miss"))
            invalid.push({ score, darts, outRule });
        }
    console.log(`MISSING ${missing.length}: ${JSON.stringify(missing)}\nINVALID ${invalid.length}: ${JSON.stringify(invalid)}\nIMPOSSIBLE-BUT-SUGGESTED ${surplus.length}: ${JSON.stringify(surplus)}`);
    expect({ missing, invalid, surplus }).toEqual({ missing: [], invalid: [], surplus: [] });
  });
});
