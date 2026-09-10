import type { Match, Player, PlayerId } from "../../domain/match/models";

export function persistentStatisticsPlayers(
  savedPlayers: readonly Player[],
  matches: readonly Match[],
): readonly Player[] {
  const participantIds = new Set(matches.flatMap((match) => match.players));
  return savedPlayers.filter((player) => participantIds.has(player.id));
}

export function persistentParticipantsInMatch(
  savedPlayers: readonly Player[],
  match: Match,
): readonly PlayerId[] {
  const savedIds = new Set(savedPlayers.map((player) => player.id));
  return match.players.filter((playerId) => savedIds.has(playerId));
}
