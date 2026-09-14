import type { Player } from '../match/models';

/** Normalization is used only to offer an existing identity, never to merge identities implicitly. */
export const normalizePlayerName = (value: string): string =>
  value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('ru-RU');

export const playersMatchingName = (players: readonly Player[], name: string): readonly Player[] => {
  const normalized = normalizePlayerName(name);
  return normalized ? players.filter((player) => normalizePlayerName(player.name) === normalized) : [];
};
