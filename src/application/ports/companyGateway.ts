import type { Match, Player } from '../../domain/match/models';
export type SharedCompany = Readonly<{ token: string; name: string; createdAt: string }>;
export type CompanySnapshot = Readonly<{
  company: Omit<SharedCompany, 'token'>;
  players: readonly Player[];
  matches: readonly Match[];
  /** Сколько записей снимка отброшено как некорректные (вместо отказа от всего снимка). */
  skippedMatches?: number;
  skippedPlayers?: number;
}>;

/** Ошибка транспорта с кодом ответа. Позволяет отличать неустранимые отказы от временных. */
export class HttpError extends Error {
  readonly status: number;
  readonly permanent: boolean;
  constructor(message: string, status: number, permanent: boolean = isPermanentStatus(status)) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.permanent = permanent;
  }
}

/** 4xx, кроме 408 (таймаут) и 429 (слишком часто), повторять бессмысленно. */
export function isPermanentStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

export function isPermanentFailure(error: unknown): boolean {
  return error instanceof HttpError && error.permanent;
}

export function failureReason(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : 'Неизвестная ошибка';
}

export interface CompanyGateway {
  createCompany(name: string): Promise<SharedCompany>;
  loadCompany(token: string): Promise<CompanySnapshot>;
  createPlayer(token: string, name: string): Promise<Player>;
  renamePlayer(token: string, playerId: string, name: string): Promise<Player>;
  resetPlayerStatistics(token: string, playerId: string): Promise<Player>;
  deletePlayer(token: string, playerId: string): Promise<void>;
  uploadMatch(token: string, match: Match): Promise<void>;
  deleteMatch(token: string, matchId: string): Promise<void>;
}
