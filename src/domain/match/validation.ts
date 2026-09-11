import { scoreOf, type DartThrow } from '../darts/DartThrow';
import { isReachableThreeDartScore } from './aggregateScore';
import type { Match } from './models';

/**
 * Единственный валидатор Match в проекте: используется и хранилищем (IndexedDB),
 * и сетевым адаптером. Никаких вторых копий этой логики быть не должно.
 */

// TODO: заменить на MAX_PLAYERS из ./models, как только константа будет там экспортирована.
export const MAX_PLAYERS = 8;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const isInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
const isIdList = (value: unknown): value is string[] => Array.isArray(value) && value.every(isText);
const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key));
const isUnique = (values: readonly string[]): boolean => new Set(values).size === values.length;

function isDart(value: unknown): value is DartThrow {
  if (!isRecord(value) || !isText(value.kind)) return false;
  if (['miss', 'bull', 'outer_bull'].includes(value.kind)) return hasOnlyKeys(value, ['kind']);
  return value.kind === 'number'
    && hasOnlyKeys(value, ['kind', 'segment', 'multiplier'])
    && isInteger(value.segment) && value.segment >= 1 && value.segment <= 20
    && (value.multiplier === 1 || value.multiplier === 2 || value.multiplier === 3);
}

function isPlayerNumberRecord(value: unknown, players: readonly string[], minimum: number): boolean {
  return isRecord(value) && players.every((playerId) => {
    const score = value[playerId];
    return isInteger(score) && score >= minimum;
  });
}

function isVisitContext(value: unknown, players: readonly string[]): boolean {
  return isRecord(value)
    && isPlayerNumberRecord(value.scores, players, 0)
    && isInteger(value.currentPlayerIndex)
    && value.currentPlayerIndex >= 0
    && value.currentPlayerIndex < players.length;
}

function isVisit(value: unknown, matchId: string, players: readonly string[]): boolean {
  if (!isRecord(value) || !isText(value.id) || value.matchId !== matchId || !isText(value.playerId)
    || !players.includes(value.playerId) || !isInteger(value.visitIndex) || value.visitIndex < 0
    || !isInteger(value.physicalDartsUsed) || value.physicalDartsUsed < 0
    || !isInteger(value.rawScore) || value.rawScore < 0
    || !isInteger(value.awardedScore) || value.awardedScore < 0
    || !isVisitContext(value.before, players) || !isVisitContext(value.after, players)
    || !['scored', 'bust', 'match_won', 'tie_pending'].includes(String(value.result))
    || !isText(value.timestamp)) return false;
  if (value.inputKind === 'aggregate')
    return value.physicalDartsUsed === 3 && isInteger(value.aggregateScore)
      && value.aggregateScore === value.rawScore && isReachableThreeDartScore(value.aggregateScore)
      && value.darts === undefined;
  return (value.inputKind === undefined || value.inputKind === 'detailed')
    && Array.isArray(value.darts) && value.darts.length <= 3 && value.darts.every(isDart)
    && value.physicalDartsUsed === value.darts.length
    && value.rawScore === value.darts.reduce((total: number, dart: DartThrow) => total + scoreOf(dart), 0);
}

/** Необязательный список участников фазы: либо отсутствует, либо корректное подмножество игроков матча. */
function isOptionalPhasePlayerIds(value: unknown, players: readonly string[]): boolean {
  if (value === undefined) return true;
  return isIdList(value) && value.length >= 1 && isUnique(value) && value.every((id) => players.includes(id));
}
function isOptionalPhaseScores(value: unknown, players: readonly string[]): boolean {
  if (value === undefined) return true;
  return isRecord(value)
    && Object.entries(value).every(([id, score]) => players.includes(id) && isInteger(score) && score >= 0);
}
function isOptionalRound(value: unknown): boolean {
  return value === undefined || (isInteger(value) && value >= 1);
}

/**
 * Фазы X01. Принимаются обе формы: историческая (regulation / awaiting_tie_break / tie_break)
 * и новая — ничья `completed_draw`.
 */
function isX01Phase(value: unknown, players: readonly string[]): boolean {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  if (value.kind === 'regulation') return true;
  if (value.kind === 'completed_draw')
    return isOptionalPhasePlayerIds(value.playerIds, players)
      && isOptionalRound(value.round)
      && isOptionalPhaseScores(value.roundScores, players)
      && isOptionalPhasePlayerIds(value.completedPlayerIds, players)
      && hasOnlyKeys(value, ['kind', 'playerIds', 'completedPlayerIds', 'roundScores', 'round']);
  if (value.kind !== 'awaiting_tie_break' && value.kind !== 'tie_break') return false;
  const playerIds = value.playerIds;
  if (!isIdList(playerIds) || playerIds.length < 2 || !isUnique(playerIds)
    || !playerIds.every((id) => players.includes(id))
    || !isInteger(value.round) || value.round < 1) return false;
  if (value.kind === 'awaiting_tie_break') return hasOnlyKeys(value, ['kind', 'playerIds', 'round']);
  return isIdList(value.completedPlayerIds) && isUnique(value.completedPlayerIds)
    && value.completedPlayerIds.every((id) => playerIds.includes(id))
    && isRecord(value.roundScores)
    && Object.entries(value.roundScores).every(([id, score]) => playerIds.includes(id) && isInteger(score) && score >= 0)
    && hasOnlyKeys(value, ['kind', 'playerIds', 'completedPlayerIds', 'roundScores', 'round']);
}

/**
 * Фазы Fixed Visits. Принимаются обе формы: старая (`{ kind, round }` — так лежат уже
 * сохранённые у пользователей матчи) и новая, с необязательными playerIds / roundScores /
 * completedPlayerIds в фазах awaiting_tie_decision и extra_round.
 */
function isFixedVisitsPhase(value: unknown, players: readonly string[]): boolean {
  if (!isRecord(value)) return false;
  if (value.kind === 'regulation') return hasOnlyKeys(value, ['kind']);
  if (!['awaiting_tie_decision', 'extra_round', 'completed_draw'].includes(String(value.kind))) return false;
  return isInteger(value.round) && value.round >= 1
    && isOptionalPhasePlayerIds(value.playerIds, players)
    && isOptionalPhasePlayerIds(value.completedPlayerIds, players)
    && isOptionalPhaseScores(value.roundScores, players)
    && hasOnlyKeys(value, ['kind', 'round', 'playerIds', 'completedPlayerIds', 'roundScores']);
}

/** Полная строгая проверка матча: состав, визиты, дротики, согласованность rawScore, фазы. */
export function isStoredMatch(value: unknown): value is Match {
  if (!isRecord(value) || !isText(value.id) || !isText(value.createdAt)
    || !['in_progress', 'completed', 'abandoned'].includes(String(value.status))
    || !isIdList(value.players) || value.players.length < 2 || value.players.length > MAX_PLAYERS
    || !isUnique(value.players)
    || !isInteger(value.startingPlayerIndex) || value.startingPlayerIndex < 0 || value.startingPlayerIndex >= value.players.length
    || !isInteger(value.currentPlayerIndex) || value.currentPlayerIndex < 0 || value.currentPlayerIndex >= value.players.length
    || !isRecord(value.participantNames) || !Array.isArray(value.confirmedVisits) || !isRecord(value.state)) return false;
  const matchId = value.id, players = value.players, participantNames = value.participantNames;
  if (!players.every((id) => isText(participantNames[id]))) return false;
  if (value.winnerId !== undefined && (!isText(value.winnerId) || !players.includes(value.winnerId))) return false;
  if (value.status !== 'in_progress' && !isText(value.completedAt)) return false;
  if (!value.confirmedVisits.every((visit) => isVisit(visit, matchId, players))) return false;
  const state = value.state;
  if (state.kind === 'x01') {
    if ((state.startingScore !== 301 && state.startingScore !== 501 && state.startingScore !== 701)
      || (state.outRule !== 'straight' && state.outRule !== 'double')
      || !isRecord(state.format)
      || !isPlayerNumberRecord(state.remaining, players, 0)
      || !isPlayerNumberRecord(state.visitsCompleted, players, 0)
      || !isX01Phase(state.phase, players)) return false;
    return state.format.kind === 'unlimited'
      || (state.format.kind === 'limited' && isInteger(state.format.visitsPerPlayer)
        && state.format.visitsPerPlayer >= 1 && state.format.visitsPerPlayer <= 999);
  }
  return state.kind === 'fixed_visits'
    && isInteger(state.visitsPerPlayer) && state.visitsPerPlayer >= 1
    && isPlayerNumberRecord(state.totals, players, 0)
    && isPlayerNumberRecord(state.regulationCompleted, players, 0)
    && isInteger(state.extraRoundsCompleted) && state.extraRoundsCompleted >= 0
    && isFixedVisitsPhase(state.phase, players);
}

/** Матч, пришедший от сервера компании: всегда завершённый или прерванный. */
export function isSharedMatch(value: unknown): value is Match {
  return isStoredMatch(value) && value.status !== 'in_progress';
}

export function isSharedPlayer(value: unknown): value is { id: string; name: string; createdAt: string; statsResetAt?: string } {
  return isRecord(value) && isText(value.id) && isText(value.name) && isText(value.createdAt)
    && (value.statsResetAt === undefined || isText(value.statsResetAt));
}

/**
 * Приводит записи прежних версий клиента к текущей форме: X01 без startingScore/outRule и
 * визиты без inputKind. Применяется везде, где матч приходит извне (хранилище, сеть, копия).
 */
export function migrateMatch(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.state)) return value;
  const state = value.state.kind === 'x01'
    ? { ...value.state, startingScore: value.state.startingScore ?? 501, outRule: value.state.outRule ?? 'straight' }
    : value.state;
  const confirmedVisits = Array.isArray(value.confirmedVisits)
    ? value.confirmedVisits.map((visit) =>
        isRecord(visit) && visit.inputKind === undefined ? { ...visit, inputKind: 'detailed' } : visit)
    : value.confirmedVisits;
  return { ...value, state, confirmedVisits };
}
