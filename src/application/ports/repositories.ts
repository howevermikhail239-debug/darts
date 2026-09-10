import type { VisitDraft } from '../../domain/match/VisitDraft';
import type { Match, Player, PlayerId } from '../../domain/match/models';

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
}>;
export interface MatchRepository {
  saveActive(record: ActiveMatchRecord): Promise<void>;
  loadActive(): Promise<ActiveMatchRecord|undefined>;
  archiveAndClearActive(match: Match): Promise<void>;
  listHistory(): Promise<readonly Match[]>;
}
export interface PlayerRepository { list(): Promise<readonly Player[]>; save(player: Player): Promise<void>; }
export interface SettingsRepository { load(): Promise<Readonly<Record<string,string>>>; save(values: Readonly<Record<string,string>>): Promise<void>; }
export type BackupData = Readonly<{
  players: readonly Player[];
  matches: readonly Match[];
  active?: ActiveMatchRecord;
  settings: Readonly<Record<string, string>>;
}>;
export interface BackupRepository {
  readAll(): Promise<BackupData>;
  replaceAll(data: BackupData): Promise<void>;
}
