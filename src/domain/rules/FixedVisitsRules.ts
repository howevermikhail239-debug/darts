import { scoreOf } from "../darts/DartThrow";
import type { VisitDraft } from "../match/VisitDraft";
import { currentPlayerId, type FixedVisitsState, type Match, type Visit } from "../match/models";
import type { DraftEvaluation, GameRules } from "./GameRules";
import { isDetailedDraft } from '../match/VisitDraft';
import { isReachableThreeDartScore } from '../match/aggregateScore';

export class FixedVisitsRules implements GameRules {
  evaluateDraft(draft: VisitDraft, match: Match): DraftEvaluation {
    if (match.state.kind !== "fixed_visits")
      throw new Error("FixedVisitsRules применимы только к серии");
    if (!isDetailedDraft(draft)) {
      const rawScore = draft.score ?? 0;
      if (draft.score === undefined) return { status: 'in_progress', physicalDartsUsed: 0, rawScore: 0, awardedScore: 0, canAddNextDart: true, validDartCount: 0 };
      if (!isReachableThreeDartScore(rawScore)) return { status: 'invalid', physicalDartsUsed: 3, rawScore, awardedScore: 0, canAddNextDart: false, validDartCount: 0, reason: 'Такая сумма невозможна тремя дротиками' };
      return { status: 'ready_to_confirm', physicalDartsUsed: 3, rawScore, awardedScore: rawScore, canAddNextDart: false, validDartCount: 0 };
    }
    const rawScore = draft.darts.reduce((sum, dart) => sum + scoreOf(dart), 0);
    return {
      status: draft.darts.length === 3 ? "ready_to_confirm" : "in_progress",
      physicalDartsUsed: draft.darts.length,
      rawScore,
      awardedScore: rawScore,
      canAddNextDart: draft.darts.length < 3,
      validDartCount: draft.darts.length,
    };
  }
  applyConfirmedVisit(visit: Visit, match: Match): Match {
    if (match.state.kind !== "fixed_visits") throw new Error("Неверный режим");
    if (match.players.length === 0) throw new Error("Матч не содержит участников");
    const state = match.state;
    const id = visit.playerId;
    if (id !== currentPlayerId(match)) throw new Error("Визит принадлежит не текущему игроку");
    const currentTotal = state.totals[id];
    if (typeof currentTotal !== "number" || !Number.isFinite(currentTotal) || !Number.isInteger(currentTotal) || currentTotal < 0)
      throw new Error("Некорректный итог игрока");
    const totals = {
      ...state.totals,
      [id]: currentTotal + visit.awardedScore,
    };
    const inExtraRound = state.phase.kind === "extra_round";
    const currentCompleted = state.regulationCompleted[id];
    if (!inExtraRound && (typeof currentCompleted !== "number" || !Number.isFinite(currentCompleted) || !Number.isInteger(currentCompleted) || currentCompleted < 0))
      throw new Error("Некорректный счётчик подходов игрока");
    const regulationCompleted = inExtraRound
      ? state.regulationCompleted
      : {
          ...state.regulationCompleted,
          [id]: (currentCompleted as number) + 1,
        };
    const nextIndex = (match.currentPlayerIndex + 1) % match.players.length;
    const allRegulationDone = match.players.every(
      (playerId) =>
        (regulationCompleted[playerId] ?? 0) >= state.visitsPerPlayer,
    );
    const roundEnds = nextIndex === match.startingPlayerIndex;
    if (allRegulationDone && (!inExtraRound || roundEnds)) {
      const values = match.players.map((playerId) => {
        const value = totals[playerId];
        if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < 0)
          throw new Error("Некорректный итог игрока");
        return value;
      });
      const maximum = Math.max(...values);
      const tied = values.filter((value) => value === maximum).length > 1;
      const extraRoundsCompleted = inExtraRound
        ? state.extraRoundsCompleted + 1
        : state.extraRoundsCompleted;
      if (!tied) {
        const winnerIndex = values.indexOf(maximum);
        return {
          ...match,
          state: {
            ...state,
            totals,
            regulationCompleted,
            extraRoundsCompleted,
            phase: state.phase,
          },
          confirmedVisits: [...match.confirmedVisits, visit],
          currentPlayerIndex: nextIndex,
          status: "completed",
          completedAt: visit.timestamp,
          winnerId: match.players[winnerIndex]!,
        };
      }
      const round = inExtraRound ? state.phase.round + 1 : 1;
      return {
        ...match,
        state: {
          ...state,
          totals,
          regulationCompleted,
          extraRoundsCompleted,
          phase: { kind: "awaiting_tie_decision", round },
        },
        currentPlayerIndex: nextIndex,
        confirmedVisits: [...match.confirmedVisits, visit],
      };
    }
    return {
      ...match,
      state: {
        ...state,
        totals,
        regulationCompleted,
        extraRoundsCompleted: state.extraRoundsCompleted,
        phase: state.phase,
      } as FixedVisitsState,
      currentPlayerIndex: nextIndex,
      confirmedVisits: [...match.confirmedVisits, visit],
    };
  }

  startExtraRound(match: Match): Match {
    if (match.state.kind !== "fixed_visits" || match.state.phase.kind !== "awaiting_tie_decision")
      throw new Error("Дополнительный подход сейчас недоступен");
    return {
      ...match,
      currentPlayerIndex: match.startingPlayerIndex,
      state: {
        ...match.state,
        phase: { kind: "extra_round", round: match.state.phase.round },
      },
    };
  }

  completeDraw(match: Match, now: string): Match {
    if (match.state.kind !== "fixed_visits" || match.state.phase.kind !== "awaiting_tie_decision")
      throw new Error("Матч не ожидает решения о ничьей");
    return {
      ...match,
      status: "completed",
      completedAt: now,
      state: {
        ...match.state,
        phase: { kind: "completed_draw", round: match.state.phase.round },
      },
    };
  }
}
