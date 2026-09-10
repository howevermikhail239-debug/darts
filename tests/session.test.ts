import { describe, expect, it } from "vitest";
import { GameSession } from "../src/application/GameSession";
import type {
  ActiveMatchRecord,
  MatchRepository,
} from "../src/application/ports/repositories";
import { createMatch } from "../src/domain/match/createMatch";
import { bull, miss, numberThrow } from "../src/domain/darts/DartThrow";
import { statisticsForMatch } from "../src/domain/statistics/StatisticsCalculator";
class MemoryRepo implements MatchRepository {
  active: ActiveMatchRecord | undefined;
  history: import("../src/domain/match/models").Match[] = [];
  async saveActive(r: ActiveMatchRecord) {
    this.active = structuredClone(r);
  }
  async loadActive() {
    return this.active;
  }
  async archiveAndClearActive(m: import("../src/domain/match/models").Match) {
    this.history.push(m);
    this.active = undefined;
  }
  async listHistory() {
    return this.history;
  }
}
class DeferredRepo extends MemoryRepo {
  release: (() => void) | undefined;
  defer = false;
  override async saveActive(record: ActiveMatchRecord) {
    if (this.defer)
      await new Promise<void>((resolve) => {
        this.release = resolve;
      });
    await super.saveActive(record);
  }
}
class RejectNextRepo extends MemoryRepo {
  rejectNext = false;
  override async saveActive(record: ActiveMatchRecord) {
    if (this.rejectNext) {
      this.rejectNext = false;
      throw new Error("storage unavailable");
    }
    await super.saveActive(record);
  }
}
let seq = 0;
const id = () => `id-${++seq}`,
  clock = () => `2026-09-07T12:00:0${seq}.000Z`;
const withRemaining = (
  m: import("../src/domain/match/models").Match,
  a: number,
) => {
  if (m.state.kind !== "x01") throw new Error("test setup");
  return {
    ...m,
    state: { ...m.state, remaining: { a, b: 501 } },
  } as import("../src/domain/match/models").Match;
};
describe("GameSession", () => {
  it("creates a deeply immutable confirmed visit", async () => {
    const repo = new MemoryRepo();
    const match = createMatch("immutable", ["a", "b"], { mode: "fixed_visits", visitsPerPlayer: 1, startingPlayerIndex: 0 }, clock());
    const session = new GameSession(match, repo, id, clock);
    await session.record(miss()); await session.record(miss()); await session.record(miss());
    await session.confirm();
    const visit = session.snapshot().match.confirmedVisits[0]!;
    expect('darts' in visit && Object.isFrozen(visit.darts)).toBe(true);
    expect(Object.isFrozen(visit.before)).toBe(true);
    expect(Object.isFrozen(visit.before.scores)).toBe(true);
    expect(Object.isFrozen(visit.after)).toBe(true);
    expect(Object.isFrozen(visit.after.scores)).toBe(true);
  });
  it("draft cannot mutate match and confirmation is atomic", async () => {
    const repo = new MemoryRepo(),
      m = createMatch(
        "m",
        ["a", "b"],
        { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 },
        clock(),
      );
    const s = new GameSession(m, repo, id, clock);
    await s.record(numberThrow(20, 3));
    expect(s.snapshot().match.state).toEqual(m.state);
    await s.record(numberThrow(20, 3));
    await s.record(numberThrow(20, 3));
    await Promise.all([s.confirm(), s.confirm()]);
    expect(s.snapshot().match.confirmedVisits).toHaveLength(1);
    expect(repo.active?.current.confirmedVisits).toHaveLength(1);
    expect(s.snapshot().match.currentPlayerIndex).toBe(1);
  });
  it("undo fully restores bust and survives reload", async () => {
    const repo = new MemoryRepo(),
      m = createMatch(
        "m",
        ["a", "b"],
        { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 },
        clock(),
      );
    const near = withRemaining(m, 32);
    const s = new GameSession(near, repo, id, clock);
    await s.record(numberThrow(20, 3));
    await s.confirm();
    expect(s.snapshot().match.confirmedVisits[0]?.result).toBe("bust");
    const persisted = await repo.loadActive();
    const reloaded = new GameSession(
      persisted!.current,
      repo,
      id,
      clock,
      persisted!.previous,
      persisted!.draft,
    );
    await reloaded.undo();
    expect(reloaded.snapshot().match).toEqual(near);
  });
  it("undo reopens a completed match", async () => {
    const repo = new MemoryRepo(),
      m = createMatch(
        "m",
        ["a", "b"],
        { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 },
        clock(),
      );
    const near = withRemaining(m, 50);
    const s = new GameSession(near, repo, id, clock);
    await s.record(bull());
    await s.confirm();
    expect(s.snapshot().match.status).toBe("completed");
    await s.undo();
    expect(s.snapshot().match.status).toBe("in_progress");
  });
  it("fixed series gives equal visits then handles tie and extra round", async () => {
    const repo = new MemoryRepo(),
      m = createMatch(
        "m",
        ["a", "b"],
        { mode: "fixed_visits", visitsPerPlayer: 1, startingPlayerIndex: 0 },
        clock(),
      );
    const s = new GameSession(m, repo, id, clock);
    for (let p = 0; p < 2; p++) {
      await s.record(miss());
      await s.record(miss());
      await s.record(miss());
      await s.confirm();
    }
    expect(s.snapshot().match.state).toMatchObject({
      phase: { kind: "awaiting_tie_decision", round: 1 },
      regulationCompleted: { a: 1, b: 1 },
    });
    await s.extraRound();
    for (let p = 0; p < 2; p++) {
      await s.record(p === 0 ? numberThrow(20, 3) : miss());
      await s.record(miss());
      await s.record(miss());
      await s.confirm();
    }
    expect(s.snapshot().match).toMatchObject({
      status: "completed",
      winnerId: "a",
    });
  });
  it("statistics derive raw hits and awarded bust points", async () => {
    const repo = new MemoryRepo(),
      m = createMatch(
        "m",
        ["a", "b"],
        { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 },
        clock(),
      );
    const near = withRemaining(m, 32);
    const s = new GameSession(near, repo, id, clock);
    await s.record(numberThrow(20, 3));
    await s.confirm();
    const stat = statisticsForMatch(s.snapshot().match).a!;
    expect(stat).toMatchObject({
      physicalDarts: 1,
      rawPoints: 60,
      awardedPoints: 0,
      triples: 1,
    });
  });
  it("statistics treat a winning single as a normal awarded finish", async () => {
    const repo = new MemoryRepo();
    const match = createMatch("single-finish", ["a", "b"], { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 }, clock());
    const session = new GameSession(withRemaining(match, 1), repo, id, clock);
    await session.record(numberThrow(1, 1));
    await session.confirm();
    expect(statisticsForMatch(session.snapshot().match).a).toMatchObject({
      physicalDarts: 1,
      rawPoints: 1,
      awardedPoints: 1,
      singles: 1,
      winningHits: { S1: 1 },
      finishes: [1],
    });
  });
  it("publishes busy synchronously and rejects every competing mutation", async () => {
    const repo = new DeferredRepo();
    const match = createMatch(
      "busy",
      ["a", "b"],
      { mode: "fixed_visits", visitsPerPlayer: 5, startingPlayerIndex: 0 },
      clock(),
    );
    const session = new GameSession(match, repo, id, clock);
    await session.record(miss()); await session.record(miss()); await session.record(miss());
    repo.defer = true;
    const pending = session.confirm();
    expect(session.snapshot().isConfirming).toBe(true);
    await expect(session.record(miss())).rejects.toThrow("Подтверждение уже выполняется");
    await expect(session.reset()).rejects.toThrow("Подтверждение уже выполняется");
    await expect(session.undo()).rejects.toThrow("Подтверждение уже выполняется");
    repo.release?.();
    await pending;
    expect(session.snapshot().match.confirmedVisits).toHaveLength(1);
  });
  it.each([2, 3, 5, 8])("cycles turns across %i players", async (count) => {
    const ids = Array.from({ length: count }, (_, index) => `p${index}`);
    const repo = new MemoryRepo();
    const match = createMatch("many", ids, { mode: "fixed_visits", visitsPerPlayer: 1, startingPlayerIndex: count - 1 }, clock());
    const session = new GameSession(match, repo, id, clock);
    const seen: string[] = [];
    for (let turn = 0; turn < count; turn += 1) {
      seen.push(session.snapshot().match.players[session.snapshot().match.currentPlayerIndex]!);
      await session.record(miss()); await session.record(miss()); await session.record(miss());
      await session.confirm();
    }
    expect(seen).toEqual([ids.at(-1), ...ids.slice(0, -1)]);
    expect(session.snapshot().match.state).toMatchObject({ regulationCompleted: Object.fromEntries(ids.map((playerId) => [playerId, 1])), phase: { kind: "awaiting_tie_decision", round: 1 } });
  });
  it.each([2, 3, 5])("limited 501 waits for the full final round across %i players", async (count) => {
    const ids = Array.from({ length: count }, (_, index) => `p${index}`);
    const repo = new MemoryRepo();
    const match = createMatch("limited", ids, { mode: "x01", format: { kind: "limited", visitsPerPlayer: 1 }, startingPlayerIndex: 0 }, clock());
    const session = new GameSession(match, repo, id, clock);
    for (let index = 0; index < count; index += 1) {
      await session.record(index === 0 ? numberThrow(20, 1) : miss()); await session.record(miss()); await session.record(miss());
      await session.confirm();
      expect(session.snapshot().match.status).toBe(index === count - 1 ? "completed" : "in_progress");
    }
    expect(session.snapshot().match.winnerId).toBe("p0");
  });
  it("limited 501 ends immediately when a player reaches zero", async () => {
    const repo = new MemoryRepo();
    const base = createMatch("early", ["a", "b"], { mode: "x01", format: { kind: "limited", visitsPerPlayer: 20 }, startingPlayerIndex: 0 }, clock());
    const session = new GameSession(withRemaining(base, 60), repo, id, clock);
    await session.record(numberThrow(20, 3));
    await session.confirm();
    expect(session.snapshot().match).toMatchObject({ status: "completed", winnerId: "a" });
  });
  it("limited 501 tie-break includes only minimum-remaining leaders and resolves after their full round", async () => {
    const repo = new MemoryRepo();
    const match = createMatch("tie", ["a", "b", "c"], { mode: "x01", format: { kind: "limited", visitsPerPlayer: 1 }, startingPlayerIndex: 0 }, clock());
    const session = new GameSession(match, repo, id, clock);
    for (const first of [numberThrow(10, 1), numberThrow(10, 1), miss()]) {
      await session.record(first); await session.record(miss()); await session.record(miss()); await session.confirm();
    }
    expect(session.snapshot().match.state).toMatchObject({ phase: { kind: "awaiting_tie_break", playerIds: ["a", "b"], round: 1 } });
    await session.extraRound();
    await session.record(numberThrow(20, 1)); await session.record(miss()); await session.record(miss()); await session.confirm();
    expect(session.snapshot().match.status).toBe("in_progress");
    expect(session.snapshot().match.currentPlayerIndex).toBe(1);
    await session.record(numberThrow(10, 1)); await session.record(miss()); await session.record(miss()); await session.confirm();
    expect(session.snapshot().match).toMatchObject({ status: "completed", winnerId: "a" });
  });
  it("does not award a tie-break before every tied leader completes the round", async () => {
    const repo = new MemoryRepo();
    const base = createMatch("tie-zero", ["a", "b"], { mode: "x01", format: { kind: "limited", visitsPerPlayer: 1 }, startingPlayerIndex: 0 }, clock());
    if (base.state.kind !== "x01") throw new Error("test setup");
    const awaiting = {
      ...base,
      state: {
        ...base.state,
        remaining: { a: 1, b: 2 },
        visitsCompleted: { a: 1, b: 1 },
        phase: { kind: "awaiting_tie_break" as const, playerIds: ["a", "b"], round: 1 },
      },
    };
    const session = new GameSession(awaiting, repo, id, clock);
    await session.extraRound();
    await session.record(numberThrow(1, 1));
    await session.record(miss());
    await session.record(miss());
    await session.confirm();
    expect(session.snapshot().match).toMatchObject({ status: "in_progress", currentPlayerIndex: 1 });
    await session.record(miss()); await session.record(miss()); await session.record(miss());
    await session.confirm();
    expect(session.snapshot().match).toMatchObject({ status: "completed", winnerId: "a" });
  });
  it("keeps a 0:0 limited-501 tie break resolvable by comparing that round's scores", async () => {
    const repo = new MemoryRepo();
    const base = createMatch("zero-tie", ["a", "b"], { mode: "x01", format: { kind: "limited", visitsPerPlayer: 1 }, startingPlayerIndex: 0 }, clock());
    if (base.state.kind !== "x01") throw new Error("test setup");
    const awaiting = {
      ...base,
      state: { ...base.state, remaining: { a: 0, b: 0 }, visitsCompleted: { a: 1, b: 1 }, phase: { kind: "awaiting_tie_break" as const, playerIds: ["a", "b"], round: 1 } },
    };
    const session = new GameSession(awaiting, repo, id, clock);
    await session.extraRound();
    for (const points of [20, 20]) {
      await session.record(numberThrow(points, 1)); await session.record(miss()); await session.record(miss()); await session.confirm();
    }
    expect(session.snapshot().match.state).toMatchObject({ phase: { kind: "awaiting_tie_break", round: 2, playerIds: ["a", "b"] } });
    await session.extraRound();
    await session.record(numberThrow(20, 1)); await session.record(miss()); await session.record(miss()); await session.confirm();
    await session.record(miss()); await session.record(miss()); await session.record(miss()); await session.confirm();
    expect(session.snapshot().match).toMatchObject({ status: "completed", winnerId: "a" });
  });
  it("persists every add, replace, remove, and reset of the active draft", async () => {
    const repo = new MemoryRepo();
    const match = createMatch("draft-commands", ["a", "b"], { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 }, clock());
    const session = new GameSession(match, repo, id, clock);

    await session.record(numberThrow(20, 3));
    expect(repo.active?.draft).toMatchObject({ playerId: "a", draft: { darts: [numberThrow(20, 3)] } });
    await session.record(numberThrow(10, 1));
    expect(repo.active?.draft.draft.darts).toEqual([numberThrow(20, 3), numberThrow(10, 1)]);
    await session.record(numberThrow(5, 1), 0);
    expect(repo.active?.draft.draft.darts).toEqual([numberThrow(5, 1), numberThrow(10, 1)]);
    await session.remove();
    expect(repo.active?.draft.draft.darts).toEqual([numberThrow(5, 1)]);
    await session.reset();
    expect(repo.active?.draft.draft.darts).toEqual([]);
    expect(session.snapshot().match).toEqual(match);
  });
  it("does not publish a draft mutation when persistence fails and allows retry", async () => {
    const repo = new RejectNextRepo();
    const match = createMatch("draft-failure", ["a", "b"], { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 }, clock());
    const session = new GameSession(match, repo, id, clock);
    repo.rejectNext = true;
    await expect(session.record(numberThrow(20, 1))).rejects.toThrow("storage unavailable");
    expect(session.snapshot()).toMatchObject({ match, draft: { darts: [] }, isConfirming: false });
    await session.record(numberThrow(20, 1));
    expect(session.snapshot().draft.darts).toEqual([numberThrow(20, 1)]);
    expect(repo.active?.draft.draft.darts).toEqual([numberThrow(20, 1)]);
  });
  it("restores a two-dart draft without applying it and can confirm it", async () => {
    const repo = new MemoryRepo();
    const match = createMatch("restored-draft", ["a", "b"], { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 }, clock());
    const first = new GameSession(match, repo, id, clock);
    await first.record(numberThrow(20, 3));
    await first.record(numberThrow(10, 1));
    const active = (await repo.loadActive())!;

    const restored = new GameSession(active.current, repo, id, clock, active.previous, active.draft);
    expect(restored.snapshot().match).toEqual(match);
    expect(restored.snapshot().draft.darts).toEqual([numberThrow(20, 3), numberThrow(10, 1)]);
    await restored.record(numberThrow(5, 1));
    await restored.confirm();
    expect(restored.snapshot().match.state).toMatchObject({ remaining: { a: 426, b: 501 } });
    expect(restored.snapshot().match.confirmedVisits).toHaveLength(1);
  });
  it("restores and confirms early finishes and busts", async () => {
    const finishRepo = new MemoryRepo();
    const base = createMatch("restored-finish", ["a", "b"], { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 }, clock());
    const finishMatch = withRemaining(base, 60);
    const finish = new GameSession(finishMatch, finishRepo, id, clock);
    await finish.record(numberThrow(20, 3));
    const finishActive = (await finishRepo.loadActive())!;
    const restoredFinish = new GameSession(finishActive.current, finishRepo, id, clock, finishActive.previous, finishActive.draft);
    expect(restoredFinish.snapshot().evaluation.status).toBe("match_won");
    await restoredFinish.confirm();
    expect(restoredFinish.snapshot().match.status).toBe("completed");

    const bustRepo = new MemoryRepo();
    const bustMatch = withRemaining(base, 32);
    const bust = new GameSession(bustMatch, bustRepo, id, clock);
    await bust.record(numberThrow(20, 3));
    const bustActive = (await bustRepo.loadActive())!;
    const restoredBust = new GameSession(bustActive.current, bustRepo, id, clock, bustActive.previous, bustActive.draft);
    expect(restoredBust.snapshot().evaluation.status).toBe("bust");
    await restoredBust.confirm();
    expect(restoredBust.snapshot().match).toMatchObject({ currentPlayerIndex: 1, state: { remaining: { a: 32, b: 501 } } });
  });
  it("does not silently discard a current draft during Undo", async () => {
    const repo = new MemoryRepo();
    const match = createMatch("draft-undo", ["a", "b"], { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 }, clock());
    const session = new GameSession(match, repo, id, clock);
    await session.record(miss()); await session.record(miss()); await session.record(miss()); await session.confirm();
    await session.record(numberThrow(20, 1));
    await expect(session.undo()).rejects.toThrow("Сначала сбросьте незавершённый подход");
    expect(session.snapshot().draft.darts).toEqual([numberThrow(20, 1)]);
    await session.undo(true);
    expect(session.snapshot().draft.darts).toEqual([]);
    expect(session.snapshot().match).toEqual(match);
  });
  it("removes an unconfirmed draft when abandoning or finalizing", async () => {
    const abandonRepo = new MemoryRepo();
    const match = createMatch("draft-abandon", ["a", "b"], { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 }, clock());
    const abandoned = new GameSession(match, abandonRepo, id, clock);
    await abandoned.record(numberThrow(20, 1));
    await abandoned.abandon();
    expect(abandonRepo.active).toBeUndefined();
    expect(abandonRepo.history[0]?.confirmedVisits).toHaveLength(0);

    const finishRepo = new MemoryRepo();
    const finish = new GameSession(withRemaining(match, 1), finishRepo, id, clock);
    await finish.record(numberThrow(1, 1));
    await finish.confirm();
    await finish.finalize();
    expect(finishRepo.active).toBeUndefined();
    expect(finishRepo.history[0]?.confirmedVisits).toHaveLength(1);
  });
});
