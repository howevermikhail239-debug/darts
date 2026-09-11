import { useCallback, useMemo } from "react";
import type { Match, Player } from "../../domain/match/models";
import type { useCompanySync } from "./useCompanySync";
import type { useMatchSession } from "./useMatchSession";

type CompanyState = ReturnType<typeof useCompanySync>;
type MatchState = ReturnType<typeof useMatchSession>;

export type DataSource = Readonly<{
  /** true — данные компании, false — локальные данные устройства. */
  shared: boolean;
  players: readonly Player[];
  history: readonly Match[];
  addPlayer: (name: string) => Promise<Player>;
  renamePlayer: (playerId: string, name: string) => Promise<unknown>;
  resetPlayerStatistics: (playerId: string) => Promise<unknown>;
  deletePlayer: (playerId: string) => Promise<unknown>;
  deleteMatch: (matchId: string) => Promise<void>;
}>;

/**
 * Единственное место, которое знает о двух источниках данных (ARCH-3).
 *
 * `App.tsx` после этого работает с одним набором операций и не переключает
 * каждый обработчик тернарником прямо в JSX. Здесь же живёт единственная копия
 * правила доступа «нельзя удалить игрока из незавершённого матча» — раньше оно
 * было продублировано в `App.tsx` и в `useMatchSession`.
 */
export function useDataSource(company: CompanyState, match: MatchState): DataSource {
  const shared = Boolean(company.company);
  const activeMatch = (match.active ?? match.resume)?.snapshot.match;

  const deletePlayer = useCallback(async (playerId: string) => {
    if (activeMatch?.status === "in_progress" && activeMatch.players.includes(playerId))
      throw new Error("Нельзя удалить игрока из незавершённого матча.");
    await (shared ? company.deletePlayer(playerId) : match.deletePlayer(playerId));
  }, [activeMatch, company, match, shared]);

  return useMemo<DataSource>(() => ({
    shared,
    players: shared ? company.players : match.players,
    history: shared ? company.history : match.history,
    addPlayer: shared ? company.addPlayer : match.addPlayer,
    renamePlayer: shared ? company.renamePlayer : match.renamePlayer,
    resetPlayerStatistics: shared ? company.resetPlayerStatistics : match.resetPlayerStatistics,
    deletePlayer,
    deleteMatch: async (matchId: string) => { await (shared ? company.deleteMatch(matchId) : match.deleteMatch(matchId)); },
  }), [company, deletePlayer, match, shared]);
}
