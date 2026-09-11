import type { Match, Player, PlayerId } from "../../domain/match/models";

export function persistentStatisticsPlayers(
  savedPlayers: readonly Player[],
  _matches: readonly Match[],
): readonly Player[] {
  void _matches;
  return savedPlayers;
}

export function persistentParticipantsInMatch(
  savedPlayers: readonly Player[],
  match: Match,
): readonly PlayerId[] {
  const savedIds = new Set(savedPlayers.map((player) => player.id));
  return match.players.filter((playerId) => savedIds.has(playerId));
}
