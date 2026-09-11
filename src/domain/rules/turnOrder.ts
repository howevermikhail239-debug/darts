import type { Match, PlayerId } from '../match/models';
import { domainError } from '../errors';

/** Index of a player inside the match roster; throws when the id does not belong to the match. */
export const playerIndex = (match: Match, playerId: PlayerId): number => {
  const index = match.players.indexOf(playerId);
  if (index < 0) throw domainError('invalid_player_index', 'Игрок отсутствует в матче');
  return index;
};

/** Keeps the seating order of the match but starts the sequence at the starting player. */
export const orderedFromStarter = (match: Match, playerIds: readonly PlayerId[]): readonly PlayerId[] => {
  const eligible = new Set(playerIds);
  return Array.from({ length: match.players.length }, (_, offset) =>
    match.players[(match.startingPlayerIndex + offset) % match.players.length],
  ).filter((id): id is PlayerId => id !== undefined && eligible.has(id));
};

/** Guards a score-like record read out of persisted state. */
export const requiredScore = (
  scores: Readonly<Record<PlayerId, number>>,
  playerId: PlayerId,
  label: string,
): number => {
  const score = scores[playerId];
  if (typeof score !== 'number' || !Number.isFinite(score) || !Number.isInteger(score) || score < 0)
    throw domainError(label === 'остаток' ? 'invalid_remaining' : 'invalid_total', `Некорректный ${label} игрока`);
  return score;
};
