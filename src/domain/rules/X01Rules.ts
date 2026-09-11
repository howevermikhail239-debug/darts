import { scoreOf } from '../darts/DartThrow';
import type { VisitDraft } from '../match/VisitDraft';
import { currentPlayerId, type Match, type PlayerId, type Visit, type X01State } from '../match/models';
import type { DraftEvaluation, GameRules } from './GameRules';
import { isDetailedDraft } from '../match/VisitDraft';
import { isReachableThreeDartScore } from '../match/aggregateScore';
import { orderedFromStarter, playerIndex, requiredScore } from './turnOrder';

/** A draw may be agreed only once the tie survived a full extra round of its own. */
export const MIN_DRAW_ROUND = 2;

const leadersByMinimumRemaining = (state: X01State, playerIds: readonly PlayerId[]): readonly PlayerId[] => {
  if (playerIds.length === 0) throw new Error('Нельзя определить лидера без участников');
  const scores = playerIds.map((id) => requiredScore(state.remaining, id, 'остаток'));
  const minimum = Math.min(...scores);
  return playerIds.filter((_, index) => scores[index] === minimum);
};

const completedMatch = (match: Match, state: X01State, visit: Visit, winnerId: PlayerId): Match => ({
  ...match,
  state,
  confirmedVisits: [...match.confirmedVisits, visit],
  currentPlayerIndex: playerIndex(match, winnerId),
  status: 'completed',
  completedAt: visit.timestamp,
  winnerId,
});

/**
 * In the limited format reaching zero does not end the match: the rest of the round is still
 * played and the winner is decided afterwards by the minimum remaining score. Such a visit is
 * recorded as `tie_pending` until it is known whether it actually won.
 */
const pendingFinish = (visit: Visit): Visit =>
  visit.result === 'match_won' ? Object.freeze({ ...visit, result: 'tie_pending' as const }) : visit;

/** Restores the `match_won` marker on the winner's own checkout once the round is over. */
const promoteWinningFinish = (visits: readonly Visit[], winnerId: PlayerId): readonly Visit[] => {
  const index = visits.reduce(
    (found, visit, position) => (visit.playerId === winnerId && visit.result === 'tie_pending' ? position : found),
    -1,
  );
  return index < 0
    ? visits
    : visits.map((visit, position) =>
        position === index ? Object.freeze({ ...visit, result: 'match_won' as const }) : visit,
      );
};

export class X01Rules implements GameRules {
  evaluateDraft(draft: VisitDraft, match: Match): DraftEvaluation {
    if (match.state.kind !== 'x01') throw new Error('X01Rules применимы только к X01');
    if (!isDetailedDraft(draft)) {
      const score = draft.score;
      if (score === undefined)
        return {
          status: 'in_progress',
          physicalDartsUsed: 0,
          rawScore: 0,
          awardedScore: 0,
          canAddNextDart: true,
          validDartCount: 0,
        };
      if (!isReachableThreeDartScore(score))
        return {
          status: 'invalid',
          physicalDartsUsed: 3,
          rawScore: score,
          awardedScore: 0,
          canAddNextDart: false,
          validDartCount: 0,
          reason: 'Такая сумма невозможна тремя дротиками',
        };
      if (match.state.phase.kind === 'tie_break')
        return {
          status: 'ready_to_confirm',
          physicalDartsUsed: 3,
          rawScore: score,
          awardedScore: score,
          canAddNextDart: false,
          validDartCount: 0,
        };
      const playerId = currentPlayerId(match);
      const start = match.state.remaining[playerId];
      if (start === undefined) throw new Error('Нет счёта текущего игрока');
      const after = start - score;
      // A sum below zero is an unambiguous bust and needs no sectors; a sum that lands exactly on a
      // finish (or on the unplayable 1 with double-out) still needs the last dart to be named.
      if (after < 0)
        return {
          status: 'bust',
          physicalDartsUsed: 3,
          rawScore: score,
          awardedScore: 0,
          canAddNextDart: false,
          remainingAfter: start,
          validDartCount: 0,
          reason: 'Перебор — счёт ниже нуля',
        };
      if (after <= (match.state.outRule === 'double' ? 1 : 0))
        return {
          status: 'invalid',
          physicalDartsUsed: 3,
          rawScore: score,
          awardedScore: 0,
          canAddNextDart: false,
          remainingAfter: start,
          validDartCount: 0,
          reason: 'Для завершения используйте ввод по дротикам',
        };
      return {
        status: 'ready_to_confirm',
        physicalDartsUsed: 3,
        rawScore: score,
        awardedScore: score,
        canAddNextDart: false,
        remainingAfter: after,
        validDartCount: 0,
      };
    }
    if (match.state.phase.kind === 'tie_break') {
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
    const playerId = currentPlayerId(match);
    const start = match.state.remaining[playerId];
    if (start === undefined) throw new Error('Нет счёта текущего игрока');
    let remaining = start;
    let rawScore = 0;
    for (let i = 0; i < draft.darts.length; i += 1) {
      const dart = draft.darts[i];
      if (!dart) continue;
      const points = scoreOf(dart);
      rawScore += points;
      remaining -= points;
      const isDouble = dart.kind === 'bull' || (dart.kind === 'number' && dart.multiplier === 2);
      if (remaining < 0 || (match.state.outRule === 'double' && (remaining === 1 || (remaining === 0 && !isDouble)))) {
        const reason =
          remaining < 0
            ? 'Счёт ниже нуля'
            : remaining === 1
              ? 'Остаток 1 нельзя закрыть удвоением'
              : 'Последний дротик должен попасть в удвоение или Bull';
        return {
          status: 'bust',
          physicalDartsUsed: i + 1,
          rawScore,
          awardedScore: 0,
          canAddNextDart: false,
          remainingAfter: start,
          reason,
          validDartCount: i + 1,
        };
      }
      if (remaining === 0)
        return {
          status: 'match_won',
          physicalDartsUsed: i + 1,
          rawScore,
          awardedScore: rawScore,
          canAddNextDart: false,
          remainingAfter: 0,
          validDartCount: i + 1,
        };
    }
    return {
      status: draft.darts.length === 3 ? 'ready_to_confirm' : 'in_progress',
      physicalDartsUsed: draft.darts.length,
      rawScore,
      awardedScore: rawScore,
      canAddNextDart: draft.darts.length < 3,
      remainingAfter: remaining,
      validDartCount: draft.darts.length,
    };
  }

  applyConfirmedVisit(visit: Visit, match: Match): Match {
    if (match.state.kind !== 'x01') throw new Error('Неверный режим');
    const state = match.state;
    const playerId = visit.playerId;
    if (playerId !== currentPlayerId(match)) throw new Error('Визит принадлежит не текущему игроку');
    const remaining =
      state.phase.kind === 'tie_break' || visit.result === 'bust'
        ? state.remaining
        : { ...state.remaining, [playerId]: requiredScore(state.remaining, playerId, 'остаток') - visit.awardedScore };
    const visitsCompleted =
      state.phase.kind === 'regulation'
        ? {
            ...state.visitsCompleted,
            [playerId]: requiredScore(state.visitsCompleted, playerId, 'счётчик подходов') + 1,
          }
        : state.visitsCompleted;
    const nextState = { ...state, remaining, visitsCompleted } as X01State;
    const finishesTheRound = state.phase.kind === 'regulation' && state.format.kind === 'limited';

    if (visit.result === 'match_won' && !finishesTheRound) return completedMatch(match, nextState, visit, playerId);

    if (state.phase.kind === 'tie_break') {
      const completedPlayerIds = [...state.phase.completedPlayerIds, playerId];
      const roundScores = { ...state.phase.roundScores, [playerId]: visit.awardedScore };
      const remainingParticipants = state.phase.playerIds.filter((id) => !completedPlayerIds.includes(id));
      const roundFinishedState = {
        ...nextState,
        phase: { ...state.phase, completedPlayerIds, roundScores },
      } as X01State;
      if (remainingParticipants.length > 0) {
        const nextId = remainingParticipants[0]!;
        return {
          ...match,
          state: roundFinishedState,
          currentPlayerIndex: playerIndex(match, nextId),
          confirmedVisits: [...match.confirmedVisits, visit],
        };
      }
      if (state.phase.playerIds.length === 0) throw new Error('Нет участников дополнительного подхода');
      const bestScore = Math.max(
        ...state.phase.playerIds.map((id) => requiredScore(roundScores, id, 'результат дополнительного подхода')),
      );
      const leaders = state.phase.playerIds.filter(
        (id) => requiredScore(roundScores, id, 'результат дополнительного подхода') === bestScore,
      );
      if (leaders.length === 1) return completedMatch(match, roundFinishedState, visit, leaders[0]!);
      const ordered = orderedFromStarter(match, leaders);
      const first = ordered[0];
      if (!first) throw new Error('Не удалось определить лидера дополнительного подхода');
      return {
        ...match,
        state: {
          ...roundFinishedState,
          phase: { kind: 'awaiting_tie_break', playerIds: ordered, round: state.phase.round + 1 },
        },
        currentPlayerIndex: playerIndex(match, first),
        confirmedVisits: [...match.confirmedVisits, visit],
      };
    }

    const nextIndex = (match.currentPlayerIndex + 1) % match.players.length;
    if (state.format.kind === 'limited') {
      const visitsPerPlayer = state.format.visitsPerPlayer;
      const regulationComplete = match.players.every((id) => (visitsCompleted[id] ?? 0) >= visitsPerPlayer);
      // A checkout stops the match at the end of its own round: everybody gets the same number of
      // visits, and the result is read from the remaining scores once that round is complete.
      const roundComplete = nextIndex === match.startingPlayerIndex;
      const someoneFinished = match.players.some((id) => remaining[id] === 0);
      if (regulationComplete || (someoneFinished && roundComplete)) {
        const leaders = leadersByMinimumRemaining(nextState, match.players);
        if (leaders.length === 1) {
          const winnerId = leaders[0]!;
          const completed = completedMatch(match, nextState, visit, winnerId);
          return { ...completed, confirmedVisits: promoteWinningFinish(completed.confirmedVisits, winnerId) };
        }
        const ordered = orderedFromStarter(match, leaders);
        const first = ordered[0];
        if (!first) throw new Error('Не удалось определить лидера матча');
        return {
          ...match,
          state: { ...nextState, phase: { kind: 'awaiting_tie_break', playerIds: ordered, round: 1 } },
          currentPlayerIndex: playerIndex(match, first),
          confirmedVisits: [...match.confirmedVisits, pendingFinish(visit)],
        };
      }
    }
    return {
      ...match,
      state: nextState,
      currentPlayerIndex: nextIndex,
      confirmedVisits: [...match.confirmedVisits, pendingFinish(visit)],
    };
  }

  startExtraRound(match: Match): Match {
    if (match.state.kind !== 'x01' || match.state.phase.kind !== 'awaiting_tie_break')
      throw new Error('Дополнительный подход сейчас недоступен');
    const playerIds = match.state.phase.playerIds;
    const first = playerIds[0];
    if (!first) throw new Error('Нет участников дополнительного подхода');
    return {
      ...match,
      currentPlayerIndex: playerIndex(match, first),
      state: {
        ...match.state,
        phase: {
          kind: 'tie_break',
          playerIds,
          completedPlayerIds: [],
          roundScores: {},
          round: match.state.phase.round,
        },
      },
    };
  }

  canCompleteDraw(match: Match): boolean {
    return (
      match.state.kind === 'x01' &&
      match.state.phase.kind === 'awaiting_tie_break' &&
      match.state.phase.round >= MIN_DRAW_ROUND
    );
  }

  completeDraw(match: Match, now: string): Match {
    if (match.state.kind !== 'x01' || match.state.phase.kind !== 'awaiting_tie_break')
      throw new Error('Матч не ожидает решения о ничьей');
    if (match.state.phase.round < MIN_DRAW_ROUND)
      throw new Error('Ничью можно зафиксировать только со второго дополнительного круга');
    const phase = match.state.phase;
    return {
      ...match,
      status: 'completed',
      completedAt: now,
      state: {
        ...match.state,
        phase: { kind: 'completed_draw', playerIds: phase.playerIds, round: phase.round },
      },
    };
  }
}
