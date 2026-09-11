import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { isSharedMatch, isStoredMatch, MAX_PLAYERS } from "../src/domain/match/validation";
import { IndexedDbMatchRepository, clearLocalData } from "../src/infrastructure/persistence/IndexedDbRepositories";
import { createMatch } from "../src/domain/match/createMatch";
import { emptyDraft } from "../src/domain/match/VisitDraft";
import type { Match } from "../src/domain/match/models";

const fixedVisits = createMatch("fv", ["a", "b"], { mode: "fixed_visits", visitsPerPlayer: 3, startingPlayerIndex: 0 }, "2026-09-01T10:00:00.000Z");
const x01 = createMatch("x01", ["a", "b"], { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 }, "2026-09-01T10:00:00.000Z");
const withPhase = (match: Match, phase: unknown): unknown => ({ ...match, state: { ...match.state, phase } });

/** Формы фаз, уже лежащие в сохранённых у пользователей матчах, и новые формы того же смысла. */
const acceptedFixedVisitsPhases: readonly (readonly [string, unknown])[] = [
  ["старая regulation", { kind: "regulation" }],
  ["старая awaiting_tie_decision", { kind: "awaiting_tie_decision", round: 1 }],
  ["старая extra_round", { kind: "extra_round", round: 2 }],
  ["старая completed_draw", { kind: "completed_draw", round: 2 }],
  ["новая awaiting_tie_decision с участниками", { kind: "awaiting_tie_decision", round: 1, playerIds: ["a", "b"] }],
  ["новая extra_round с очками раунда", { kind: "extra_round", round: 2, playerIds: ["a", "b"], roundScores: { a: 40, b: 0 }, completedPlayerIds: ["a"] }],
];
const acceptedX01Phases: readonly (readonly [string, unknown])[] = [
  ["regulation", { kind: "regulation" }],
  ["awaiting_tie_break", { kind: "awaiting_tie_break", playerIds: ["a", "b"], round: 1 }],
  ["tie_break", { kind: "tie_break", playerIds: ["a", "b"], completedPlayerIds: ["a"], roundScores: { a: 60 }, round: 1 }],
  ["новая completed_draw", { kind: "completed_draw", playerIds: ["a", "b"], round: 2 }],
  ["completed_draw без необязательных полей", { kind: "completed_draw" }],
];
const rejectedPhases: readonly (readonly [string, Match, unknown])[] = [
  ["неизвестный вид фазы", fixedVisits, { kind: "teleported", round: 1 }],
  ["extra_round без раунда", fixedVisits, { kind: "extra_round" }],
  ["участник фазы вне матча", fixedVisits, { kind: "extra_round", round: 1, playerIds: ["outsider"] }],
  ["нецелые очки раунда", fixedVisits, { kind: "extra_round", round: 1, roundScores: { a: 1.5 } }],
  ["посторонний ключ фазы", fixedVisits, { kind: "extra_round", round: 1, surprise: true }],
  ["tie_break без playerIds", x01, { kind: "tie_break", completedPlayerIds: [], roundScores: {}, round: 1 }],
  ["completed_draw с чужим игроком", x01, { kind: "completed_draw", playerIds: ["ghost"], round: 1 }],
];

describe("match phase compatibility", () => {
  afterEach(() => clearLocalData());

  it.each(acceptedFixedVisitsPhases)("accepts a Fixed Visits match with %s", (_label, phase) => {
    expect(isStoredMatch(withPhase(fixedVisits, phase))).toBe(true);
  });

  it.each(acceptedX01Phases)("accepts an X01 match with %s", (_label, phase) => {
    expect(isStoredMatch(withPhase(x01, phase))).toBe(true);
  });

  it.each(rejectedPhases)("rejects %s", (_label, match, phase) => {
    expect(isStoredMatch(withPhase(match, phase))).toBe(false);
  });

  it("still loads a stored match whose phase carries the new optional fields", async () => {
    const repository = new IndexedDbMatchRepository();
    const stored = withPhase(fixedVisits, { kind: "extra_round", round: 2, playerIds: ["a", "b"], roundScores: { a: 40, b: 40 }, completedPlayerIds: [] }) as Match;
    await repository.saveActive({ current: stored, draft: { playerId: "a", draft: emptyDraft() } });
    expect((await repository.loadActive())?.current.state.phase).toMatchObject({ kind: "extra_round", round: 2 });
  });

  it("treats only finished matches as shareable and caps the roster at MAX_PLAYERS", () => {
    expect(isSharedMatch(x01)).toBe(false);
    expect(isSharedMatch({ ...x01, status: "completed", completedAt: "2026-09-01T11:00:00.000Z", winnerId: "a" })).toBe(true);
    const crowd = Array.from({ length: MAX_PLAYERS + 1 }, (_unused, index) => `p${index}`);
    const oversized = {
      ...x01,
      players: crowd,
      participantNames: Object.fromEntries(crowd.map((id) => [id, id])),
      state: {
        ...x01.state,
        remaining: Object.fromEntries(crowd.map((id) => [id, 501])),
        visitsCompleted: Object.fromEntries(crowd.map((id) => [id, 0])),
      },
    };
    expect(isStoredMatch(oversized)).toBe(false);
  });
});
