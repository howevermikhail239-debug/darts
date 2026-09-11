import type { MatchSetup } from '../domain/match/createMatch';
import type { Player, PlayerId } from '../domain/match/models';
import type { MatchParticipantInput } from './StartMatch';

export type LastSetupParticipant = Readonly<{
  name: string;
  playerId?: PlayerId;
}>;

export type LastSetupTemplate = Readonly<{
  participants: readonly LastSetupParticipant[];
  setup: MatchSetup;
}>;

export interface LastSetupRepository {
  load(context: string): Promise<LastSetupTemplate | undefined>;
  save(context: string, template: LastSetupTemplate): Promise<void>;
}

export const lastSetupContext = (companyToken?: string): string => (companyToken ? `company:${companyToken}` : 'local');

export function createLastSetupTemplate(
  participants: readonly MatchParticipantInput[],
  setup: MatchSetup,
): LastSetupTemplate {
  return {
    participants: participants.map((participant) => ({
      name: participant.name.trim(),
      ...(participant.playerId ? { playerId: participant.playerId } : {}),
    })),
    setup: structuredClone(setup),
  };
}

export type RestoredSetupParticipant = Readonly<{
  name: string;
  playerId?: PlayerId;
  missingPlayerId?: PlayerId;
}>;

export function restoreLastSetupParticipants(
  template: LastSetupTemplate | undefined,
  players: readonly Player[],
): readonly RestoredSetupParticipant[] | undefined {
  if (!template) return undefined;
  const byId = new Map(players.map((player) => [player.id, player]));
  return template.participants.map((participant) => {
    if (!participant.playerId) return { name: participant.name };
    const player = byId.get(participant.playerId);
    return player
      ? { name: player.name, playerId: player.id }
      : { name: participant.name, missingPlayerId: participant.playerId };
  });
}
