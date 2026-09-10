import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import {
  IndexedDbMatchRepository,
  clearLocalData,
} from "../src/infrastructure/persistence/IndexedDbRepositories";
import { createMatch } from "../src/domain/match/createMatch";
import { emptyDraft } from "../src/domain/match/VisitDraft";
import { numberThrow } from "../src/domain/darts/DartThrow";

async function putRawActive(value: unknown): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("dart-scorekeeper", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      try {
        const database = request.result;
        const transaction = database.transaction("meta", "readwrite");
        transaction.objectStore("meta").put(value, "activeMatch");
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      } catch (error) { reject(error); }
    };
  });
}
async function putRawHistory(value: unknown): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("dart-scorekeeper", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      try {
        const database = request.result;
        const transaction = database.transaction("matches", "readwrite");
        transaction.objectStore("matches").put(value);
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      } catch (error) { reject(error); }
    };
  });
}

function validVisit(match: ReturnType<typeof createMatch>) {
  return {
    id: "visit-1",
    matchId: match.id,
    playerId: "a",
    visitIndex: 0,
    darts: [numberThrow(20, 1)],
    physicalDartsUsed: 1,
    rawScore: 20,
    awardedScore: 20,
    before: { scores: { a: 501, b: 501 }, currentPlayerIndex: 0 },
    after: { scores: { a: 481, b: 501 }, currentPlayerIndex: 1 },
    result: "scored",
    timestamp: "2026-09-08T12:00:00.000Z",
  };
}
describe("IndexedDB repository", () => {
  afterEach(() => clearLocalData());
  it("persists current and previous checkpoint", async () => {
    const repo = new IndexedDbMatchRepository(),
      m = createMatch(
        "m",
        ["a", "b"],
        { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 },
        new Date().toISOString(),
      );
    const draft = { playerId: "a", draft: emptyDraft() };
    await repo.saveActive({ current: m, previous: m, draft });
    expect(await repo.loadActive()).toEqual({ current: m, previous: m, draft });
  });
  it("migrates an old X01 save without startingScore or outRule to 501 straight-out", async () => {
    const repo = new IndexedDbMatchRepository();
    const match = createMatch("legacy-x01", ["a", "b"], { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 }, new Date().toISOString());
    if (match.state.kind !== 'x01') throw new Error('test setup');
    const legacyState = Object.fromEntries(
      Object.entries(match.state).filter(([key]) => key !== 'startingScore' && key !== 'outRule'),
    );
    await repo.saveActive({ current: match, draft: { playerId: 'a', draft: emptyDraft() } });
    await putRawActive({ schemaVersion: 2, current: { ...match, state: legacyState }, draft: { playerId: 'a', draft: emptyDraft() } });
    expect((await repo.loadActive())?.current.state).toMatchObject({ kind: 'x01', startingScore: 501, outRule: 'straight' });
  });
  it("rejects the obsolete X01 leg format instead of silently changing its rules", async () => {
    const repo = new IndexedDbMatchRepository();
    const valid = createMatch(
      "old",
      ["a", "b"],
      { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 },
      new Date().toISOString(),
    );
    const obsolete = {
      ...valid,
      state: {
        kind: "x01",
        targetLegWins: 1,
        remaining: { a: 501, b: 501 },
        legsWon: { a: 0, b: 0 },
        currentLeg: 1,
        legStarterIndex: 0,
      },
    };
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("dart-scorekeeper", 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        database.createObjectStore("matches", { keyPath: "id" });
        database.createObjectStore("players", { keyPath: "id" });
        database.createObjectStore("meta");
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("meta", "readwrite");
        transaction.objectStore("meta").put({ schemaVersion: 1, current: obsolete }, "activeMatch");
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
    });
    await expect(repo.loadActive()).rejects.toThrow("Сохранённый матч повреждён");
  });
  it("persists a player-bound draft with physical darts", async () => {
    const repo = new IndexedDbMatchRepository();
    const match = createMatch("draft", ["a", "b"], { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 }, new Date().toISOString());
    const draft = { playerId: "a", draft: { darts: [numberThrow(20, 3), numberThrow(10, 1)] } };
    await repo.saveActive({ current: match, draft });
    expect(await repo.loadActive()).toEqual({ current: match, draft });
  });
  it.each([
    ["invalid dart", { playerId: "a", draft: { darts: [{ kind: "number", segment: 21, multiplier: 3 }] } }],
    ["wrong player", { playerId: "b", draft: { darts: [numberThrow(20, 1)] } }],
    ["too many darts", { playerId: "a", draft: { darts: [numberThrow(1, 1), numberThrow(2, 1), numberThrow(3, 1), numberThrow(4, 1)] } }],
  ])("keeps a valid match and discards a corrupt draft: %s", async (_label, corruptDraft) => {
    const repo = new IndexedDbMatchRepository();
    const match = createMatch("recover", ["a", "b"], { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 }, new Date().toISOString());
    await repo.saveActive({ current: match, draft: { playerId: "a", draft: emptyDraft() } });
    await putRawActive({ schemaVersion: 2, current: match, draft: corruptDraft });
    expect(await repo.loadActive()).toEqual({
      current: match,
      draft: { playerId: "a", draft: emptyDraft() },
      draftRecovery: "discarded_corrupt",
    });
  });
  it("rejects an unsupported future active-record version", async () => {
    const repo = new IndexedDbMatchRepository();
    const match = createMatch("future", ["a", "b"], { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 }, new Date().toISOString());
    await repo.saveActive({ current: match, draft: { playerId: "a", draft: emptyDraft() } });
    await putRawActive({ schemaVersion: 99, current: match, draft: { playerId: "a", draft: emptyDraft() } });
    await expect(repo.loadActive()).rejects.toThrow("неподдерживаемую версию");
  });
  it.each([
    ["a string multiplier", (visit: ReturnType<typeof validVisit>) => ({ ...visit, darts: [{ kind: "number", segment: 20, multiplier: "3" }] })],
    ["a negative visit index", (visit: ReturnType<typeof validVisit>) => ({ ...visit, visitIndex: -1 })],
    ["a mismatched physical-dart count", (visit: ReturnType<typeof validVisit>) => ({ ...visit, physicalDartsUsed: 2 })],
    ["a mismatched raw score", (visit: ReturnType<typeof validVisit>) => ({ ...visit, rawScore: 60 })],
    ["an unknown result", (visit: ReturnType<typeof validVisit>) => ({ ...visit, result: "teleported" })],
    ["a foreign match id", (visit: ReturnType<typeof validVisit>) => ({ ...visit, matchId: "other-match" })],
    ["a player outside the match", (visit: ReturnType<typeof validVisit>) => ({ ...visit, playerId: "outsider" })],
  ])("rejects an active match with %s", async (_label, corrupt) => {
    const repo = new IndexedDbMatchRepository();
    const match = createMatch("strict-visit", ["a", "b"], { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 }, new Date().toISOString());
    const visit = corrupt(validVisit(match));
    await repo.saveActive({ current: match, draft: { playerId: "a", draft: emptyDraft() } });
    await putRawActive({ schemaVersion: 2, current: { ...match, confirmedVisits: [visit] }, draft: { playerId: "a", draft: emptyDraft() } });
    await expect(repo.loadActive()).rejects.toThrow("Сохранённый матч повреждён");
  });
  it("rejects an invalid mode state while accepting only the discriminated state kind", async () => {
    const repo = new IndexedDbMatchRepository();
    const match = createMatch("strict-state", ["a", "b"], { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 }, new Date().toISOString());
    await repo.saveActive({ current: match, draft: { playerId: "a", draft: emptyDraft() } });
    await putRawActive({ schemaVersion: 2, current: { ...match, state: { ...match.state, kind: "unknown" } }, draft: { playerId: "a", draft: emptyDraft() } });
    await expect(repo.loadActive()).rejects.toThrow("Сохранённый матч повреждён");
  });
  it("skips one corrupt history record without hiding valid history", async () => {
    const repo = new IndexedDbMatchRepository();
    const valid = createMatch("valid-history", ["a", "b"], { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 }, new Date().toISOString());
    await repo.saveActive({ current: valid, draft: { playerId: "a", draft: emptyDraft() } });
    await putRawHistory(valid);
    await putRawHistory({ ...valid, id: "broken-history", state: { ...valid.state, kind: "unknown" } });
    expect((await repo.listHistory()).map((match) => match.id)).toEqual(["valid-history"]);
  });
  it("restores a completed Fixed Visits match whose regulation phase has no artificial round", async () => {
    const repo = new IndexedDbMatchRepository();
    const base = createMatch("fixed-history", ["a", "b"], { mode: "fixed_visits", visitsPerPlayer: 1, startingPlayerIndex: 0 }, new Date().toISOString());
    const completed = { ...base, status: "completed" as const, completedAt: "2026-09-08T12:00:00.000Z", winnerId: "a" };
    await repo.saveActive({ current: base, draft: { playerId: "a", draft: emptyDraft() } });
    await putRawHistory(completed);
    expect(await repo.listHistory()).toEqual([completed]);
  });
});
