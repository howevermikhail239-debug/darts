import type { VisitDraft } from '../../domain/match/VisitDraft';
import type { Match, Player, PlayerId } from '../../domain/match/models';
import type { LastSetupTemplate } from '../LastSetup';
export type { LastSetupRepository } from '../LastSetup';

export type ActiveVisitDraft = Readonly<{
  playerId: PlayerId;
  draft: VisitDraft;
}>;
export type ActiveMatchRecord = Readonly<{
  current: Match;
  previous?: Match;
  draft: ActiveVisitDraft;
  companyToken?: string;
  draftRecovery?: "discarded_corrupt" | "missing_legacy";
  /** Монотонная ревизия конверта активного матча (оптимистическая блокировка между вкладками). */
  revision?: number;
}>;
/** Почему активный матч не был восстановлен, хотя запись в хранилище есть. */
export type ActiveMatchIssue = "future_version";
/** Событие об изменении активного матча в другой вкладке этого же браузера. */
export type ExternalActiveMatchChange = Readonly<{
  kind: "saved" | "cleared";
  revision: number;
  matchId?: string;
}>;
export interface MatchRepository {
  saveActive(record: ActiveMatchRecord): Promise<void>;
  loadActive(): Promise<ActiveMatchRecord|undefined>;
  archiveAndClearActive(match: Match): Promise<void>;
  listHistory(): Promise<readonly Match[]>;
  deleteHistory?(matchId: string): Promise<boolean>;
  /** История с числом пропущенных повреждённых записей (для сообщения в интерфейсе). */
  readHistory?(limit?: number): Promise<{ matches: readonly Match[]; skipped: number }>;
  /** Признак для интерфейса: запись активного матча создана более новой версией приложения. */
  activeMatchIssue?(): ActiveMatchIssue | undefined;
  /** Подписка на изменения активного матча в других вкладках. Возвращает отписку. */
  onExternalChange?(listener: (event: ExternalActiveMatchChange) => void): () => void;
}
/**
 * Запись активного матча отклонена, потому что её изменила другая вкладка.
 * Проверка по имени, чтобы презентационный слой не импортировал инфраструктуру.
 */
export const isActiveMatchConflict = (error: unknown): boolean =>
  error instanceof Error && error.name === 'ActiveMatchConflictError';

export interface PlayerRepository { list(): Promise<readonly Player[]>; save(player: Player): Promise<void>; delete?(playerId: PlayerId): Promise<boolean>; }
export interface SettingsRepository { load(): Promise<Readonly<Record<string,string>>>; save(values: Readonly<Record<string,string>>): Promise<void>; }

/** Состояние локальной записи матча компании. */
export type SharedMatchState = 'pending' | 'synced' | 'error' | 'rejected';

export type BackupCompany = Readonly<{ token: string; name: string; createdAt: string }>;
export type BackupCompanyPlayers = Readonly<{ token: string; players: readonly Player[] }>;
export type BackupCompanyMatch = Readonly<{
  token: string;
  matchId: string;
  match: Match;
  state: SharedMatchState;
  reason?: string;
}>;
export type BackupLastSetup = Readonly<{ context: string; template: LastSetupTemplate }>;

export type BackupData = Readonly<{
  players: readonly Player[];
  matches: readonly Match[];
  active?: ActiveMatchRecord;
  settings: Readonly<Record<string, string>>;
  /** Секции версии 2 копии: данные компании и шаблоны настройки. В копиях версии 1 отсутствуют. */
  companies?: readonly BackupCompany[];
  companyPlayers?: readonly BackupCompanyPlayers[];
  companyMatches?: readonly BackupCompanyMatch[];
  lastSetups?: readonly BackupLastSetup[];
}>;
export interface BackupRepository {
  readAll(): Promise<BackupData>;
  replaceAll(data: BackupData): Promise<void>;
}
