import type { MatchId, PlayerId } from '../match/models';

/**
 * Группа обычных матчей за один игровой вечер. Матчи хранятся отдельно, поэтому
 * удаление или миграция матча не создаёт вторую, потенциально рассинхронную копию.
 */
export type CompetitiveSession = Readonly<{
  id: string;
  createdAt: string;
  title?: string;
  endedAt?: string;
  playerIds: readonly PlayerId[];
  matchIds: readonly MatchId[];
  companyToken?: string;
}>;

export type TrainingKind = 'doubles' | 'around_the_clock' | 'checkout' | 'bobs_27';
export type TrainingAttempt = Readonly<{
  target: string;
  darts: readonly string[];
  success: boolean;
  score?: number;
}>;
/** Тренировка намеренно отделена от Match: её попытки не участвуют в рейтинге и match statistics. */
export type TrainingSession = Readonly<{
  id: string;
  playerId: PlayerId;
  kind: TrainingKind;
  startedAt: string;
  completedAt?: string;
  attempts: readonly TrainingAttempt[];
  settings: Readonly<Record<string, string | number | boolean>>;
}>;

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const isIdList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every(isText) && new Set(value).size === value.length;

export function isCompetitiveSession(value: unknown): value is CompetitiveSession {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    isText(item.id) &&
    isText(item.createdAt) &&
    isIdList(item.playerIds) &&
    item.playerIds.length >= 2 &&
    isIdList(item.matchIds) &&
    (item.title === undefined || isText(item.title)) &&
    (item.endedAt === undefined || isText(item.endedAt)) &&
    (item.companyToken === undefined || isText(item.companyToken))
  );
}

export function isTrainingSession(value: unknown): value is TrainingSession {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    isText(item.id) &&
    isText(item.playerId) &&
    isText(item.startedAt) &&
    ['doubles', 'around_the_clock', 'checkout', 'bobs_27'].includes(String(item.kind)) &&
    Array.isArray(item.attempts) &&
    item.attempts.every(
      (attempt) =>
        attempt &&
        typeof attempt === 'object' &&
        isText((attempt as Record<string, unknown>).target) &&
        Array.isArray((attempt as Record<string, unknown>).darts) &&
        typeof (attempt as Record<string, unknown>).success === 'boolean',
    ) &&
    item.settings !== null &&
    typeof item.settings === 'object' &&
    (item.completedAt === undefined || isText(item.completedAt))
  );
}
