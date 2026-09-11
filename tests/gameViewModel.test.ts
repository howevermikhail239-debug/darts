import { describe, expect, it } from "vitest";
import type { SessionSnapshot } from "../src/application/GameSession";
import { emptyDraft } from "../src/domain/match/VisitDraft";
import { numberThrow } from "../src/domain/darts/DartThrow";
import type { Match, Player } from "../src/domain/match/models";
import { rulesFor } from "../src/domain/rules/rulesFor";
import { toGameViewModel } from "../src/presentation/game/gameViewModel";

const players: readonly Player[] = [
  { id: "a", name: "Анна", createdAt: "2026-09-10T10:00:00.000Z" },
  { id: "b", name: "Борис", createdAt: "2026-09-10T10:00:00.000Z" },
  { id: "c", name: "Света", createdAt: "2026-09-10T10:00:00.000Z" },
];
const common = {
  id: "match",
  createdAt: "2026-09-10T10:00:00.000Z",
  status: "in_progress" as const,
  players: ["a", "b"] as readonly string[],
  participantNames: { a: "Анна", b: "Борис", c: "Света" },
  startingPlayerIndex: 0,
  currentPlayerIndex: 0,
  confirmedVisits: [],
};

const x01 = (): Match => ({
  ...common,
  state: {
    kind: "x01",
    startingScore: 501,
    outRule: "straight",
    format: { kind: "unlimited" },
    remaining: { a: 401, b: 501, c: 501 },
    visitsCompleted: { a: 1, b: 0, c: 0 },
    phase: { kind: "regulation" },
  },
});
const fixed = (): Match => ({
  ...common,
  state: {
    kind: "fixed_visits",
    visitsPerPlayer: 5,
    totals: { a: 60, b: 20, c: 10 },
    regulationCompleted: { a: 1, b: 0, c: 0 },
    extraRoundsCompleted: 0,
    phase: { kind: "regulation" },
  },
});
const snapshot = (match: Match): SessionSnapshot => {
  const draft = emptyDraft();
  return { match, draft, evaluation: rulesFor(match).evaluateDraft(draft, match), isConfirming: false };
};

describe("GameViewModel", () => {
  it("maps an ordinary X01 turn and the authoritative action state", () => {
    const view = toGameViewModel(snapshot(x01()), players);
    expect(view).toMatchObject({ title: "501 · до победы", phaseLabel: "Точный выход в 0", currentPlayerName: "Анна", currentPlayerDetail: "остаток: 401", awaitingTieDecision: false, canConfirm: false, canAddNextDart: true });
    expect(view.scoreboard.map(({ name, score, active }) => ({ name, score, active }))).toEqual([
      { name: "Анна", score: 401, active: true },
      { name: "Борис", score: 501, active: false },
    ]);
  });

  it("formats confirm labels from the authoritative draft evaluation", () => {
    const match = x01();
    const draft = { darts: [numberThrow(20, 3), numberThrow(20, 2), numberThrow(5, 1)] } as const;
    const ready: SessionSnapshot = { match, draft, evaluation: rulesFor(match).evaluateDraft(draft, match), isConfirming: false };
    expect(toGameViewModel(ready, players).confirmLabel).toBe("Подтвердить 105");
    expect(toGameViewModel({ ...ready, isConfirming: true }, players).confirmLabel).toBe("Сохраняем…");
  });

  it("maps fixed visits", () => {
    const view = toGameViewModel(snapshot(fixed()), players);
    expect(view.title).toBe("Серия · 5 подходов");
    expect(view.phaseLabel).toBe("Подход 1 из 5");
    expect(view.draftHint).toBe("Введите все три физических дротика");
  });

  it("shows a diagnostic label instead of Infinity for a corrupt visit counter", () => {
    const match = fixed();
    if (match.state.kind !== "fixed_visits") throw new Error("fixture");
    const corrupt = { ...match, state: { ...match.state, regulationCompleted: {} } } as Match;
    expect(toGameViewModel(snapshot(corrupt), players).phaseLabel).toBe("Состояние матча повреждено");
  });

  it("maps a fixed-visits tie decision", () => {
    const match = fixed();
    if (match.state.kind !== "fixed_visits") throw new Error("fixture");
    const tied: Match = { ...match, state: { ...match.state, phase: { kind: "awaiting_tie_decision", round: 1 } } };
    expect(toGameViewModel(snapshot(tied), players)).toMatchObject({ awaitingTieDecision: true, canCompleteDraw: true, phaseLabel: "Ничья после основных подходов" });
  });

  it("maps X01 tie-break decision and extra round without exposing phase unions to the page", () => {
    const match = x01();
    if (match.state.kind !== "x01") throw new Error("fixture");
    const awaiting: Match = { ...match, state: { ...match.state, format: { kind: "limited", visitsPerPlayer: 1 }, phase: { kind: "awaiting_tie_break", playerIds: ["a", "b"], round: 2 } } };
    const extra: Match = { ...awaiting, state: { ...match.state, format: { kind: "limited", visitsPerPlayer: 1 }, phase: { kind: "tie_break", playerIds: ["a", "b"], completedPlayerIds: [], roundScores: {}, round: 2 } } };
    expect(toGameViewModel(snapshot(awaiting), players)).toMatchObject({ awaitingTieDecision: true, canCompleteDraw: false, phaseLabel: "Ничья по минимальному остатку" });
    expect(toGameViewModel(snapshot(extra), players)).toMatchObject({ inExtraRound: true, phaseLabel: "Дополнительный подход 2" });
  });

  it("maps a fixed-visits extra round", () => {
    const match = fixed();
    if (match.state.kind !== "fixed_visits") throw new Error("fixture");
    const extra: Match = { ...match, state: { ...match.state, phase: { kind: "extra_round", round: 3 } } };
    expect(toGameViewModel(snapshot(extra), players)).toMatchObject({ inExtraRound: true, phaseLabel: "Дополнительный подход 3" });
  });

  it("maps completed and abandoned states", () => {
    const completed: Match = { ...x01(), status: "completed", completedAt: "2026-09-10T11:00:00.000Z", winnerId: "a" };
    const abandoned: Match = { ...fixed(), status: "abandoned", completedAt: "2026-09-10T11:00:00.000Z" };
    expect(toGameViewModel(snapshot(completed), players)).toMatchObject({ completed: true, abandoned: false, summaryEyeline: "501", summaryTitle: "Анна победила" });
    expect(toGameViewModel(snapshot(abandoned), players)).toMatchObject({ completed: false, abandoned: true });
  });

  it("maps the current player and every row in a multi-player match", () => {
    const match = fixed();
    if (match.state.kind !== "fixed_visits") throw new Error("fixture");
    const multi: Match = { ...match, players: ["a", "b", "c"], currentPlayerIndex: 2 };
    const view = toGameViewModel(snapshot(multi), players);
    expect(view.currentPlayerName).toBe("Света");
    expect(view.scoreboard).toHaveLength(3);
    expect(view.scoreboard.filter((row) => row.active).map((row) => row.playerId)).toEqual(["c"]);
  });
});
