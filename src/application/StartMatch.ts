import { createMatch, type MatchSetup } from "../domain/match/createMatch";
import type { Match, PlayerId } from "../domain/match/models";
import { GameSession, type Clock, type IdGenerator } from "./GameSession";
import type { MatchRepository, PlayerRepository } from "./ports/repositories";
import { domainError } from "../domain/errors";

export type MatchParticipantInput = Readonly<{
  name: string;
  playerId?: PlayerId;
}>;

export type StartMatchDependencies = Readonly<{
  matches: MatchRepository;
  players: PlayerRepository;
  id: IdGenerator;
  now: Clock;
  companyToken?: string;
}>;

export type StartedMatch = Readonly<{ match: Match; session: GameSession }>;

export async function startMatch(
  dependencies: StartMatchDependencies,
  participants: readonly MatchParticipantInput[],
  setup: MatchSetup,
): Promise<StartedMatch> {
  const savedPlayers = await dependencies.players.list();
  const savedById = new Map(savedPlayers.map((player) => [player.id, player]));
  const resolved = participants.map((participant) => {
    if (!participant.playerId)
      return { id: dependencies.id(), name: participant.name.trim() };
    const saved = savedById.get(participant.playerId);
    if (!saved) throw domainError("profile_missing", "Сохранённый профиль игрока не найден");
    return { id: saved.id, name: saved.name };
  });
  const now = dependencies.now();
  const match = createMatch(
    dependencies.id(),
    resolved.map((participant) => participant.id),
    setup,
    now,
    Object.fromEntries(resolved.map((participant) => [participant.id, participant.name])),
  );
  await dependencies.matches.saveActive({
    current: match,
    ...(dependencies.companyToken ? { companyToken: dependencies.companyToken } : {}),
    draft: {
      playerId: match.players[match.currentPlayerIndex]!,
      draft: { darts: [] },
    },
  });
  return {
    match,
    session: new GameSession(
      match,
      dependencies.matches,
      dependencies.id,
      dependencies.now,
      undefined,
      undefined,
      undefined,
      dependencies.companyToken,
    ),
  };
}
