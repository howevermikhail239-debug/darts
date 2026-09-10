import { describe, expect, it } from "vitest";
import {
  bull,
  miss,
  numberThrow,
  outerBull,
  scoreOf,
} from "../src/domain/darts/DartThrow";
import {
  addDraftThrow,
  emptyDraft,
  removeDraftThrow,
  replaceDraftThrow,
  resetDraft,
} from "../src/domain/match/VisitDraft";
import { createMatch } from "../src/domain/match/createMatch";
import { X01Rules } from "../src/domain/rules/X01Rules";
import { FixedVisitsRules } from "../src/domain/rules/FixedVisitsRules";
import type { Match } from "../src/domain/match/models";
const now = "2026-09-07T12:00:00.000Z";
const xmatch = (remaining = 501): Match => {
  const m = createMatch(
    "m",
    ["a", "b"],
    { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 },
    now,
  );
  if (m.state.kind !== "x01") throw new Error("test setup");
  return { ...m, state: { ...m.state, remaining: { a: remaining, b: 501 } } };
};
const draft = (...darts: ReturnType<typeof miss>[]) =>
  darts.reduce(addDraftThrow, emptyDraft());
describe("DartThrow", () => {
  it("scores every category", () => {
    expect([
      scoreOf(numberThrow(20, 1)),
      scoreOf(numberThrow(20, 2)),
      scoreOf(numberThrow(20, 3)),
      scoreOf(outerBull()),
      scoreOf(bull()),
      scoreOf(miss()),
    ]).toEqual([20, 40, 60, 25, 50, 0]);
  });
  it("rejects invalid sectors", () =>
    expect(() => numberThrow(21, 3)).toThrow());
  it("rejects an invalid multiplier at the runtime boundary", () =>
    expect(() => numberThrow(20, 4 as never)).toThrow());
});
describe("VisitDraft", () => {
  it("adds, replaces, removes and resets immutably", () => {
    const base = emptyDraft();
    const one = addDraftThrow(base, miss());
    const three = addDraftThrow(addDraftThrow(one, numberThrow(20, 3)), bull());
    expect(base.darts).toHaveLength(0);
    expect(three.darts).toHaveLength(3);
    expect(() => addDraftThrow(three, miss())).toThrow();
    expect(replaceDraftThrow(three, 0, outerBull()).darts[0]?.kind).toBe(
      "outer_bull",
    );
    expect(removeDraftThrow(three).darts).toHaveLength(2);
    expect(resetDraft().darts).toHaveLength(0);
  });
  it("MISS occupies a physical slot", () =>
    expect(addDraftThrow(emptyDraft(), miss()).darts).toHaveLength(1));
});
describe("X01Rules", () => {
  const rules = new X01Rules();
  it("evaluates normal score and 180", () => {
    expect(
      rules.evaluateDraft(
        draft(numberThrow(20, 3), numberThrow(20, 3), numberThrow(20, 3)),
        xmatch(),
      ),
    ).toMatchObject({
      status: "ready_to_confirm",
      rawScore: 180,
      remainingAfter: 321,
    });
  });
  it.each([
    [14, [numberThrow(20, 3)], "bust"],
  ] as const)("detects bust from %s", (remaining, darts, status) =>
    expect(
      rules.evaluateDraft(draft(...darts), xmatch(remaining)),
    ).toMatchObject({
      status,
      awardedScore: 0,
      remainingAfter: remaining,
      canAddNextDart: false,
    }),
  );
  it("allows straight-out with singles, triples, and Bull", () => {
    expect(
      rules.evaluateDraft(draft(numberThrow(1, 1), numberThrow(10, 1), numberThrow(3, 1)), xmatch(14)),
    ).toMatchObject({ status: "match_won", remainingAfter: 0 });
    expect(rules.evaluateDraft(draft(numberThrow(20, 1), numberThrow(20, 1)), xmatch(40))).toMatchObject({ status: "match_won", remainingAfter: 0 });
    expect(rules.evaluateDraft(draft(numberThrow(20, 3)), xmatch(60))).toMatchObject({ status: "match_won", remainingAfter: 0, physicalDartsUsed: 1 });
    expect(rules.evaluateDraft(draft(numberThrow(1, 1)), xmatch(1))).toMatchObject({ status: "match_won", remainingAfter: 0 });
    expect(rules.evaluateDraft(draft(bull()), xmatch(50))).toMatchObject({
      status: "match_won",
      remainingAfter: 0,
    });
  });
  it("allows remaining 1 and only busts below zero", () => {
    expect(rules.evaluateDraft(draft(numberThrow(13, 1)), xmatch(14))).toMatchObject({ status: "in_progress", remainingAfter: 1, awardedScore: 13 });
    expect(rules.evaluateDraft(draft(numberThrow(13, 1), numberThrow(1, 1)), xmatch(14))).toMatchObject({ status: "match_won", remainingAfter: 0 });
  });
  it.each([5, 10, 20, 30, 37])("accepts a limited 501 format with %i visits", (visitsPerPlayer) =>
    expect(createMatch("limited", ["a", "b"], { mode: "x01", format: { kind: "limited", visitsPerPlayer }, startingPlayerIndex: 0 }, now).state)
      .toMatchObject({ format: { kind: "limited", visitsPerPlayer } }));
});
describe("FixedVisitsRules", () => {
  it("requires exactly three darts and sums misses", () => {
    const rules = new FixedVisitsRules(),
      m = createMatch(
        "m",
        ["a", "b"],
        { mode: "fixed_visits", visitsPerPlayer: 5, startingPlayerIndex: 0 },
        now,
      );
    expect(
      rules.evaluateDraft(draft(numberThrow(20, 3), miss()), m).status,
    ).toBe("in_progress");
    expect(
      rules.evaluateDraft(
        draft(numberThrow(20, 3), miss(), numberThrow(20, 1)),
        m,
      ),
    ).toMatchObject({ status: "ready_to_confirm", rawScore: 80 });
  });
  it.each([5, 10, 20, 30, 37])("accepts %i visits", (n) =>
    expect(
      createMatch(
        "m",
        ["a", "b"],
        { mode: "fixed_visits", visitsPerPlayer: n, startingPlayerIndex: 0 },
        now,
      ).state,
    ).toMatchObject({ visitsPerPlayer: n }),
  );
});
