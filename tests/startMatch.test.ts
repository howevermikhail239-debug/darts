import { describe, expect, it, vi } from 'vitest';
import { startMatch } from '../src/application/StartMatch';
import type { ActiveMatchRecord, MatchRepository, PlayerRepository } from '../src/application/ports/repositories';
import type { Player } from '../src/domain/match/models';

function dependencies(saved: readonly Player[] = []) {
  let index = 0;
  const active: ActiveMatchRecord[] = [];
  const matches: MatchRepository = {
    saveActive: vi.fn(async (record: ActiveMatchRecord) => {
      active.push(record);
    }),
    loadActive: async () => active.at(-1),
    archiveAndClearActive: async () => undefined,
    listHistory: async () => [],
  };
  const players: PlayerRepository = {
    list: vi.fn(async () => saved),
    save: vi.fn(async () => undefined),
  };
  return {
    matches,
    players,
    id: () => `id-${++index}`,
    now: () => '2026-09-08T12:00:00.000Z',
  };
}

describe('startMatch participant resolution', () => {
  it('keeps quick temporary participants out of the saved-player catalogue and snapshots their names', async () => {
    const services = dependencies();
    const started = await startMatch(services, [{ name: 'Игрок 1' }, { name: 'Игрок 1' }], {
      mode: 'x01',
      format: { kind: 'unlimited' },
      startingPlayerIndex: 0,
    });
    expect(started.match.players).toEqual(['id-1', 'id-2']);
    expect(started.match.participantNames).toEqual({ 'id-1': 'Игрок 1', 'id-2': 'Игрок 1' });
    expect(services.players.save).not.toHaveBeenCalled();
    expect(services.matches.saveActive).toHaveBeenCalledOnce();
  });

  it('reuses a saved profile id only when it was selected explicitly', async () => {
    const saved = { id: 'misha-profile', name: 'Миша', createdAt: '2026-01-01T00:00:00.000Z' };
    const services = dependencies([saved]);
    const started = await startMatch(services, [{ name: 'ignored', playerId: saved.id }, { name: 'Временный' }], {
      mode: 'fixed_visits',
      visitsPerPlayer: 1,
      startingPlayerIndex: 0,
    });
    expect(started.match.players).toEqual(['misha-profile', 'id-1']);
    expect(started.match.participantNames).toEqual({ 'misha-profile': 'Миша', 'id-1': 'Временный' });
    expect(services.players.save).not.toHaveBeenCalled();
  });
});
