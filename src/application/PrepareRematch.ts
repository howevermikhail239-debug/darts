import type { MatchSetup } from '../domain/match/createMatch';
import type { Match, Player } from '../domain/match/models';
import { domainError } from '../domain/errors';
import type { MatchParticipantInput } from './StartMatch';

export type RematchRequest = Readonly<{
  participants: readonly MatchParticipantInput[];
  setup: MatchSetup;
}>;

export function setupFromMatch(match: Match): MatchSetup {
  const startingPlayerIndex = (match.startingPlayerIndex + 1) % match.players.length;
  if (match.state.kind === 'x01') {
    return {
      mode: 'x01',
      startingScore: match.state.startingScore,
      outRule: match.state.outRule,
      format: match.state.format,
      startingPlayerIndex,
    };
  }
  return {
    mode: 'fixed_visits',
    visitsPerPlayer: match.state.visitsPerPlayer,
    startingPlayerIndex,
  };
}

export function prepareRematch(match: Match, persistentPlayers: readonly Player[]): RematchRequest {
  if (match.status !== 'completed')
    throw domainError('rematch_requires_completed', 'Повторить можно только завершённый матч');
  const persistentIds = new Set(persistentPlayers.map((player) => player.id));
  return {
    participants: match.players.map((playerId) => ({
      name: match.participantNames[playerId] ?? 'Игрок',
      ...(persistentIds.has(playerId) ? { playerId } : {}),
    })),
    setup: setupFromMatch(match),
  };
}
