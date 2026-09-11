import { describe, expect, it } from "vitest";
import { GameSession } from "../src/application/GameSession";
import type { ActiveMatchRecord, MatchRepository } from "../src/application/ports/repositories";
import { miss, numberThrow } from "../src/domain/darts/DartThrow";
import { createMatch } from "../src/domain/match/createMatch";
import { MAX_PLAYERS, MIN_PLAYERS, type Match, type X01Phase } from "../src/domain/match/models";
import { FixedVisitsRules } from "../src/domain/rules/FixedVisitsRules";
import { X01Rules } from "../src/domain/rules/X01Rules";

class MemoryRepo implements MatchRepository {
  active: ActiveMatchRecord | undefined;
  history: Match[] = [];
  async saveActive(record: ActiveMatchRecord) { this.active = structuredClone(record); }
  async loadActive() { return this.active; }
  async archiveAndClearActive(match: Match) { this.history.push(match); this.active = undefined; }
  async listHistory() { return this.history; }
}

let seq = 0;
const id = () => `id-${++seq}`;
const clock = () => "2026-09-11T12:00:00.000Z";
const session = (match: Match, repo = new MemoryRepo()) => ({ repo, session: new GameSession(match, repo, id, clock) });
const visitOf = async (game: GameSession, first = miss()) => {
  await game.record(first); await game.record(miss()); await game.record(miss());
  await game.confirm();
};

const series = (players: readonly string[], visitsPerPlayer = 1): Match =>
  createMatch("series", players, { mode: "fixed_visits", visitsPerPlayer, startingPlayerIndex: 0 }, clock());

describe("Fixed visits extra round (DOM-1)", () => {
  it("keeps a trailing player out of the extra round and out of the win", async () => {
    const { session: game } = session(series(["a", "b", "c"]));
    await visitOf(game, numberThrow(20, 3)); // a = 60
    await visitOf(game, numberThrow(20, 3)); // b = 60
    await visitOf(game, numberThrow(20, 1)); // c = 20, out of the tie
    expect(game.snapshot().match.state).toMatchObject({
      totals: { a: 60, b: 60, c: 20 },
      phase: { kind: "awaiting_tie_decision", playerIds: ["a", "b"], round: 1 },
    });

    await game.extraRound();
    expect(game.snapshot().match).toMatchObject({ currentPlayerIndex: 0, state: { phase: { kind: "extra_round", playerIds: ["a", "b"], completedPlayerIds: [], roundScores: {} } } });
    await visitOf(game); // a scores 0
    expect(game.snapshot().match.currentPlayerIndex).toBe(1); // b, never c
    await visitOf(game, numberThrow(1, 1)); // b scores 1 and wins the round
    const finished = game.snapshot().match;
    expect(finished).toMatchObject({ status: "completed", winnerId: "b" });
    expect(finished.confirmedVisits.some((visit) => visit.playerId === "c" && visit.visitIndex > 2)).toBe(false);
  });

  it("decides the extra round by that round's score, not by the running totals", () => {
    const rules = new FixedVisitsRules();
    const base = series(["a", "b", "c"]);
    if (base.state.kind !== "fixed_visits") throw new Error("test setup");
    const extra: Match = {
      ...base,
      currentPlayerIndex: 1,
      state: {
        ...base.state,
        totals: { a: 60, b: 60, c: 200 },
        regulationCompleted: { a: 1, b: 1, c: 1 },
        phase: { kind: "extra_round", playerIds: ["a", "b"], completedPlayerIds: ["a"], roundScores: { a: 5 }, round: 1 },
      },
    };
    const applied = rules.applyConfirmedVisit({
      id: "v", matchId: "series", playerId: "b", visitIndex: 3, physicalDartsUsed: 3, rawScore: 3, awardedScore: 3,
      before: { scores: { a: 60, b: 60, c: 200 }, currentPlayerIndex: 1 }, after: { scores: {}, currentPlayerIndex: 0 },
      result: "scored", timestamp: clock(), darts: [],
    }, extra);
    // c leads on totals (200) and still cannot win: the round is decided by its own scores, 5 > 3.
    expect(applied).toMatchObject({ status: "completed", winnerId: "a" });
    expect(applied.state).toMatchObject({ totals: { a: 60, b: 63, c: 200 }, extraRoundsCompleted: 1 });
  });

  it("narrows the next round to the leaders of the previous one", async () => {
    const { session: game } = session(series(["a", "b", "c"]));
    for (let index = 0; index < 3; index += 1) await visitOf(game); // 0:0:0
    expect(game.snapshot().match.state).toMatchObject({ phase: { kind: "awaiting_tie_decision", playerIds: ["a", "b", "c"], round: 1 } });
    await game.extraRound();
    await visitOf(game, numberThrow(20, 1)); // a = 20
    await visitOf(game, numberThrow(20, 1)); // b = 20
    await visitOf(game, numberThrow(10, 1)); // c = 10
    expect(game.snapshot().match.state).toMatchObject({ phase: { kind: "awaiting_tie_decision", playerIds: ["a", "b"], round: 2 } });
    await game.extraRound();
    expect(game.snapshot().match.state).toMatchObject({ phase: { kind: "extra_round", playerIds: ["a", "b"], round: 2 } });
    await visitOf(game); // a = 0
    await visitOf(game, numberThrow(20, 3)); // b = 60
    expect(game.snapshot().match).toMatchObject({ status: "completed", winnerId: "b" });
  });

  it("reads a legacy phase without playerIds as everybody plays", () => {
    const rules = new FixedVisitsRules();
    const base = series(["a", "b", "c"]);
    if (base.state.kind !== "fixed_visits") throw new Error("test setup");
    const legacy: Match = {
      ...base,
      state: { ...base.state, totals: { a: 0, b: 0, c: 0 }, regulationCompleted: { a: 1, b: 1, c: 1 }, phase: { kind: "awaiting_tie_decision", round: 1 } },
    };
    expect(rules.startExtraRound(legacy).state).toMatchObject({ phase: { kind: "extra_round", playerIds: ["a", "b", "c"], round: 1 } });
  });

  it("completes a fixed-visits draw without a winner", async () => {
    const { session: game } = session(series(["a", "b"]));
    await visitOf(game);
    await visitOf(game);
    const drawn = (await game.completeDraw()).match;
    expect(drawn).toMatchObject({ status: "completed", completedAt: clock() });
    expect(drawn.winnerId).toBeUndefined();
    expect(drawn.state).toMatchObject({ phase: { kind: "completed_draw", playerIds: ["a", "b"], round: 1 } });
  });
});

describe("X01 draw (DOM-2)", () => {
  const rules = new X01Rules();
  const limited = (phase: X01Phase): Match => {
    const base = createMatch("x", ["a", "b"], { mode: "x01", format: { kind: "limited", visitsPerPlayer: 1 }, startingPlayerIndex: 0 }, clock());
    if (base.state.kind !== "x01") throw new Error("test setup");
    return { ...base, state: { ...base.state, remaining: { a: 501, b: 501 }, visitsCompleted: { a: 1, b: 1 }, phase } };
  };

  it("refuses a draw during regulation and during the first tie-break round", () => {
    const regulation = limited({ kind: "regulation" });
    expect(rules.canCompleteDraw(regulation)).toBe(false);
    expect(() => rules.completeDraw(regulation, clock())).toThrow("не ожидает решения о ничьей");
    const first = limited({ kind: "awaiting_tie_break", playerIds: ["a", "b"], round: 1 });
    expect(rules.canCompleteDraw(first)).toBe(false);
    expect(() => rules.completeDraw(first, clock())).toThrow("со второго дополнительного круга");
  });

  it("closes the match as a draw from the second round on", () => {
    const second = limited({ kind: "awaiting_tie_break", playerIds: ["a", "b"], round: 2 });
    expect(rules.canCompleteDraw(second)).toBe(true);
    const drawn = rules.completeDraw(second, clock());
    expect(drawn).toMatchObject({ status: "completed", completedAt: clock() });
    expect(drawn.winnerId).toBeUndefined();
    expect(drawn.state).toMatchObject({ phase: { kind: "completed_draw", playerIds: ["a", "b"], round: 2 } });
  });

  it("offers the draw after an all-zero tie-break round instead of looping silently", async () => {
    const { session: game } = session(limited({ kind: "awaiting_tie_break", playerIds: ["a", "b"], round: 1 }));
    await game.extraRound();
    await visitOf(game);
    await visitOf(game);
    expect(game.snapshot().match.state).toMatchObject({ phase: { kind: "awaiting_tie_break", playerIds: ["a", "b"], round: 2 } });
    expect(rules.canCompleteDraw(game.snapshot().match)).toBe(true);
    const drawn = (await game.completeDraw()).match;
    expect(drawn.status).toBe("completed");
    expect(drawn.winnerId).toBeUndefined();
  });
});

describe("Limited X01 finishes the round (DOM-4)", () => {
  it("plays the current round out and stops there, even with visits left in the format", async () => {
    const base = createMatch("mid-round", ["a", "b", "c"], { mode: "x01", format: { kind: "limited", visitsPerPlayer: 3 }, startingPlayerIndex: 0 }, clock());
    if (base.state.kind !== "x01") throw new Error("test setup");
    const { session: game } = session({ ...base, state: { ...base.state, remaining: { a: 60, b: 501, c: 501 } } });
    await visitOf(game, numberThrow(20, 3)); // a checks out on visit 1 of 3
    expect(game.snapshot().match).toMatchObject({ status: "in_progress", currentPlayerIndex: 1 });
    await visitOf(game, numberThrow(20, 1)); // b finishes the round
    expect(game.snapshot().match).toMatchObject({ status: "in_progress", currentPlayerIndex: 2 });
    await visitOf(game, numberThrow(20, 1)); // c finishes the round
    const match = game.snapshot().match;
    expect(match).toMatchObject({ status: "completed", winnerId: "a" });
    expect(match.state).toMatchObject({ visitsCompleted: { a: 1, b: 1, c: 1 } });
    expect(match.confirmedVisits.map((visit) => visit.playerId)).toEqual(["a", "b", "c"]);
    expect(match.confirmedVisits[0]).toMatchObject({ result: "match_won" });
  });

  it("lets both zero finishers share the round and go to a tie-break", async () => {
    const base = createMatch("both-zero", ["a", "b"], { mode: "x01", format: { kind: "limited", visitsPerPlayer: 1 }, startingPlayerIndex: 0 }, clock());
    if (base.state.kind !== "x01") throw new Error("test setup");
    const { session: game } = session({ ...base, state: { ...base.state, remaining: { a: 60, b: 60 } } });
    await visitOf(game, numberThrow(20, 3));
    await visitOf(game, numberThrow(20, 3));
    const match = game.snapshot().match;
    expect(match.status).toBe("in_progress");
    expect(match.state).toMatchObject({ remaining: { a: 0, b: 0 }, phase: { kind: "awaiting_tie_break", playerIds: ["a", "b"], round: 1 } });
    expect(match.confirmedVisits.map((visit) => visit.result)).toEqual(["tie_pending", "tie_pending"]);
  });

  it("keeps the checkout of the eventual winner marked as a finish", async () => {
    const base = createMatch("late-round", ["a", "b"], { mode: "x01", format: { kind: "limited", visitsPerPlayer: 1 }, startingPlayerIndex: 0 }, clock());
    if (base.state.kind !== "x01") throw new Error("test setup");
    const { session: game } = session({ ...base, state: { ...base.state, remaining: { a: 60, b: 100 } } });
    await visitOf(game, numberThrow(20, 3)); // a checks out
    await visitOf(game, numberThrow(20, 1)); // b scores 20 and loses on remaining
    const match = game.snapshot().match;
    expect(match).toMatchObject({ status: "completed", winnerId: "a" });
    expect(match.confirmedVisits[0]).toMatchObject({ playerId: "a", result: "match_won" });
  });
});

describe("Aggregate input (DOM-5)", () => {
  const rules = new X01Rules();
  const near = (score: number, outRule: "straight" | "double" = "straight"): Match => {
    const base = createMatch("agg", ["a", "b"], { mode: "x01", startingScore: 501, outRule, format: { kind: "unlimited" }, startingPlayerIndex: 0 }, clock());
    if (base.state.kind !== "x01") throw new Error("test setup");
    return { ...base, state: { ...base.state, remaining: { a: score, b: 501 } } };
  };
  const sum = (score: number) => ({ kind: "aggregate", score, darts: [] }) as const;

  it("records a real bust from a sum without inventing sectors", () => {
    expect(rules.evaluateDraft(sum(60), near(20))).toMatchObject({ status: "bust", physicalDartsUsed: 3, rawScore: 60, awardedScore: 0, remainingAfter: 20, reason: "Перебор — счёт ниже нуля" });
    expect(rules.evaluateDraft(sum(21), near(20, "double"))).toMatchObject({ status: "bust", awardedScore: 0, remainingAfter: 20 });
  });

  it("still refuses to finish the match by a sum", () => {
    expect(rules.evaluateDraft(sum(60), near(60))).toMatchObject({ status: "invalid", reason: "Для завершения используйте ввод по дротикам" });
    expect(rules.evaluateDraft(sum(20), near(20, "double"))).toMatchObject({ status: "invalid", reason: "Для завершения используйте ввод по дротикам" });
    expect(rules.evaluateDraft(sum(19), near(20, "double"))).toMatchObject({ status: "invalid", reason: "Для завершения используйте ввод по дротикам" });
  });

  it("applies an aggregate bust as a lost turn", async () => {
    const { session: game } = session(near(20));
    await game.setInputMode("aggregate");
    await game.setAggregateScore(60);
    await game.confirm();
    const match = game.snapshot().match;
    expect(match.state).toMatchObject({ remaining: { a: 20, b: 501 }, visitsCompleted: { a: 1, b: 0 } });
    expect(match.currentPlayerIndex).toBe(1);
    expect(match.confirmedVisits[0]).toMatchObject({ result: "bust", awardedScore: 0, rawScore: 60, physicalDartsUsed: 3, inputKind: "aggregate" });
  });
});

describe("Match roster limits (DOM-7)", () => {
  const roster = (count: number) => Array.from({ length: count }, (_, index) => `p${index}`);
  it("accepts the documented range", () => {
    expect(createMatch("min", roster(MIN_PLAYERS), { mode: "fixed_visits", visitsPerPlayer: 1, startingPlayerIndex: 0 }, clock()).players).toHaveLength(MIN_PLAYERS);
    expect(createMatch("max", roster(MAX_PLAYERS), { mode: "fixed_visits", visitsPerPlayer: 1, startingPlayerIndex: 0 }, clock()).players).toHaveLength(MAX_PLAYERS);
  });
  it("rejects fewer than two and more than eight participants", () => {
    expect(() => createMatch("few", roster(1), { mode: "fixed_visits", visitsPerPlayer: 1, startingPlayerIndex: 0 }, clock())).toThrow("как минимум 2");
    expect(() => createMatch("many", roster(MAX_PLAYERS + 1), { mode: "fixed_visits", visitsPerPlayer: 1, startingPlayerIndex: 0 }, clock())).toThrow("больше 8 игроков");
  });
});
