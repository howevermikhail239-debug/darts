import { scoreOf } from '../darts/DartThrow';
import type { VisitDraft } from '../match/VisitDraft';
import {
  currentPlayerId,
  type FixedVisitsPhase,
  type FixedVisitsState,
  type Match,
  type PlayerId,
  type Visit,
} from '../match/models';
import type { DraftEvaluation, GameRules } from './GameRules';
import { isDetailedDraft } from '../match/VisitDraft';
import { isReachableThreeDartScore } from '../match/aggregateScore';
import { orderedFromStarter, playerIndex, requiredScore } from './turnOrder';

type ExtraRoundPhase = Extract<FixedVisitsPhase, { kind: 'extra_round' }>;

/** Extra-round participants; a legacy phase without `playerIds` means "everyone plays". */
const participantsOf = (match: Match, phase: FixedVisitsPhase): readonly PlayerId[] =>
  'playerIds' in phase && phase.playerIds && phase.playerIds.length > 0 ? phase.playerIds : match.players;

export class FixedVisitsRules implements GameRules {
  evaluateDraft(draft: VisitDraft, match: Match): DraftEvaluation {
    if (match.state.kind !== 'fixed_visits') throw new Error('FixedVisitsRules применимы только к серии');
    if (!isDetailedDraft(draft)) {
      const rawScore = draft.score ?? 0;
      if (draft.score === undefined)
        return {
          status: 'in_progress',
          physicalDartsUsed: 0,
          rawScore: 0,
          awardedScore: 0,
          canAddNextDart: true,
          validDartCount: 0,
        };
      if (!isReachableThreeDartScore(rawScore))
        return {
          status: 'invalid',
          physicalDartsUsed: 3,
          rawScore,
          awardedScore: 0,
          canAddNextDart: false,
          validDartCount: 0,
          reason: 'Такая сумма невозможна тремя дротиками',
        };
      return {
        status: 'ready_to_confirm',
        physicalDartsUsed: 3,
        rawScore,
        awardedScore: rawScore,
        canAddNextDart: false,
        validDartCount: 0,
      };
    }
    const rawScore = draft.darts.reduce((sum, dart) => sum + scoreOf(dart), 0);
    return {
      status: draft.darts.length === 3 ? 'ready_to_confirm' : 'in_progress',
      physicalDartsUsed: draft.darts.length,
      rawScore,
      awardedScore: rawScore,
      canAddNextDart: draft.darts.length < 3,
      validDartCount: draft.darts.length,
    };
  }
  applyConfirmedVisit(visit: Visit, match: Match): Match {
    if (match.state.kind !== 'fixed_visits') throw new Error('Неверный режим');
    if (match.players.length === 0) throw new Error('Матч не содержит участников');
    const state = match.state;
    const id = visit.playerId;
    if (id !== currentPlayerId(match)) throw new Error('Визит принадлежит не текущему игроку');
    const currentTotal = state.totals[id];
    if (
      typeof currentTotal !== 'number' ||
      !Number.isFinite(currentTotal) ||
      !Number.isInteger(currentTotal) ||
      currentTotal < 0
    )
      throw new Error('Некорректный итог игрока');
    const totals = {
      ...state.totals,
      [id]: currentTotal + visit.awardedScore,
    };
    if (state.phase.kind === 'extra_round') return this.applyExtraRoundVisit(visit, match, state, state.phase, totals);
    const currentCompleted = state.regulationCompleted[id];
    if (
      typeof currentCompleted !== 'number' ||
      !Number.isFinite(currentCompleted) ||
      !Number.isInteger(currentCompleted) ||
      currentCompleted < 0
    )
      throw new Error('Некорректный счётчик подходов игрока');
    const regulationCompleted = {
      ...state.regulationCompleted,
      [id]: currentCompleted + 1,
    };
    const nextIndex = (match.currentPlayerIndex + 1) % match.players.length;
    const allRegulationDone = match.players.every(
      (playerId) => (regulationCompleted[playerId] ?? 0) >= state.visitsPerPlayer,
    );
    const base = { ...state, totals, regulationCompleted, extraRoundsCompleted: state.extraRoundsCompleted };
    if (!allRegulationDone) {
      return {
        ...match,
        state: { ...base, phase: state.phase } as FixedVisitsState,
        currentPlayerIndex: nextIndex,
        confirmedVisits: [...match.confirmedVisits, visit],
      };
    }
    const values = match.players.map((playerId) => requiredScore(totals, playerId, 'итог'));
    const maximum = Math.max(...values);
    const leaders = match.players.filter((_, index) => values[index] === maximum);
    if (leaders.length === 1) {
      return {
        ...match,
        state: { ...base, phase: state.phase } as FixedVisitsState,
        confirmedVisits: [...match.confirmedVisits, visit],
        currentPlayerIndex: nextIndex,
        status: 'completed',
        completedAt: visit.timestamp,
        winnerId: leaders[0]!,
      };
    }
    return {
      ...match,
      state: {
        ...base,
        phase: { kind: 'awaiting_tie_decision', playerIds: orderedFromStarter(match, leaders), round: 1 },
      } as FixedVisitsState,
      currentPlayerIndex: nextIndex,
      confirmedVisits: [...match.confirmedVisits, visit],
    };
  }

  /**
   * The extra round is a separate scoring contest between the tied players only: one visit each,
   * the highest score of THIS round wins. Running totals keep growing because they are the points
   * actually thrown, but they never decide the extra round.
   */
  private applyExtraRoundVisit(
    visit: Visit,
    match: Match,
    state: FixedVisitsState,
    phase: ExtraRoundPhase,
    totals: Readonly<Record<PlayerId, number>>,
  ): Match {
    const id = visit.playerId;
    const participants = participantsOf(match, phase);
    if (!participants.includes(id)) throw new Error('Игрок не участвует в дополнительном круге');
    const completedPlayerIds = [...(phase.completedPlayerIds ?? []), id];
    const roundScores = { ...(phase.roundScores ?? {}), [id]: visit.awardedScore };
    const base = { ...state, totals, regulationCompleted: state.regulationCompleted };
    const waiting = participants.filter((playerId) => !completedPlayerIds.includes(playerId));
    if (waiting.length > 0) {
      return {
        ...match,
        state: {
          ...base,
          extraRoundsCompleted: state.extraRoundsCompleted,
          phase: { kind: 'extra_round', playerIds: participants, completedPlayerIds, roundScores, round: phase.round },
        } as FixedVisitsState,
        currentPlayerIndex: playerIndex(match, waiting[0]!),
        confirmedVisits: [...match.confirmedVisits, visit],
      };
    }
    const extraRoundsCompleted = state.extraRoundsCompleted + 1;
    const scores = participants.map((playerId) =>
      requiredScore(roundScores, playerId, 'результат дополнительного подхода'),
    );
    const best = Math.max(...scores);
    const leaders = participants.filter((_, index) => scores[index] === best);
    if (leaders.length === 1) {
      const winnerId = leaders[0]!;
      return {
        ...match,
        state: {
          ...base,
          extraRoundsCompleted,
          phase: { kind: 'extra_round', playerIds: participants, completedPlayerIds, roundScores, round: phase.round },
        } as FixedVisitsState,
        confirmedVisits: [...match.confirmedVisits, visit],
        currentPlayerIndex: playerIndex(match, winnerId),
        status: 'completed',
        completedAt: visit.timestamp,
        winnerId,
      };
    }
    const ordered = orderedFromStarter(match, leaders);
    return {
      ...match,
      state: {
        ...base,
        extraRoundsCompleted,
        phase: { kind: 'awaiting_tie_decision', playerIds: ordered, round: phase.round + 1 },
      } as FixedVisitsState,
      currentPlayerIndex: playerIndex(match, ordered[0]!),
      confirmedVisits: [...match.confirmedVisits, visit],
    };
  }

  startExtraRound(match: Match): Match {
    if (match.state.kind !== 'fixed_visits' || match.state.phase.kind !== 'awaiting_tie_decision')
      throw new Error('Дополнительный подход сейчас недоступен');
    const participants = orderedFromStarter(match, participantsOf(match, match.state.phase));
    const first = participants[0];
    if (!first) throw new Error('Нет участников дополнительного подхода');
    return {
      ...match,
      currentPlayerIndex: playerIndex(match, first),
      state: {
        ...match.state,
        phase: {
          kind: 'extra_round',
          playerIds: participants,
          completedPlayerIds: [],
          roundScores: {},
          round: match.state.phase.round,
        },
      },
    };
  }

  canCompleteDraw(match: Match): boolean {
    return match.state.kind === 'fixed_visits' && match.state.phase.kind === 'awaiting_tie_decision';
  }

  completeDraw(match: Match, now: string): Match {
    if (match.state.kind !== 'fixed_visits' || match.state.phase.kind !== 'awaiting_tie_decision')
      throw new Error('Матч не ожидает решения о ничьей');
    const phase = match.state.phase;
    return {
      ...match,
      status: 'completed',
      completedAt: now,
      state: {
        ...match.state,
        phase: {
          kind: 'completed_draw',
          ...(phase.playerIds ? { playerIds: phase.playerIds } : {}),
          round: phase.round,
        },
      },
    };
  }
}
