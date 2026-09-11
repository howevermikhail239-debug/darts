import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { TabChannel, TAB_CHANNEL_NAME } from '../src/infrastructure/TabChannel';
import { IndexedDbMatchRepository, clearLocalData } from '../src/infrastructure/persistence/IndexedDbRepositories';
import { createMatch } from '../src/domain/match/createMatch';
import { emptyDraft } from '../src/domain/match/VisitDraft';
import type { ExternalActiveMatchChange } from '../src/application/ports/repositories';

const x01 = (id: string) =>
  createMatch(
    id,
    ['a', 'b'],
    { mode: 'x01', format: { kind: 'unlimited' }, startingPlayerIndex: 0 },
    '2026-09-01T10:00:00.000Z',
  );
const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('cross-tab notifications', () => {
  afterEach(() => clearLocalData());

  it('broadcasts saves and clears of the active match to other tabs', async () => {
    if (typeof BroadcastChannel === 'undefined') {
      expect(new TabChannel().supported).toBe(false);
      return;
    }
    const received: ExternalActiveMatchChange[] = [];
    // Отдельный экземпляр канала = другая вкладка: BroadcastChannel не доставляет сообщения себе.
    const listener = new TabChannel(TAB_CHANNEL_NAME);
    const unsubscribe = listener.subscribe((event) => received.push(event));

    const repository = new IndexedDbMatchRepository();
    const match = x01('broadcast');
    await repository.saveActive({ current: match, draft: { playerId: 'a', draft: emptyDraft() } });
    await flush();
    await repository.archiveAndClearActive({
      ...match,
      status: 'completed',
      completedAt: '2026-09-01T11:00:00.000Z',
      winnerId: 'a',
    });
    await flush();
    unsubscribe();

    expect(received.map((event) => event.kind)).toEqual(['saved', 'cleared']);
    expect(received[0]).toMatchObject({ revision: 1, matchId: 'broadcast' });
  });

  it('ignores foreign messages and keeps working without BroadcastChannel', async () => {
    const channel = new TabChannel('dart-scorekeeper-test');
    const received: ExternalActiveMatchChange[] = [];
    const unsubscribe = channel.subscribe((event) => received.push(event));
    if (typeof BroadcastChannel !== 'undefined') {
      const foreign = new BroadcastChannel('dart-scorekeeper-test');
      foreign.postMessage({ kind: 'nonsense' });
      foreign.postMessage({ kind: 'saved', revision: 7 });
      await flush();
      foreign.close();
      expect(received).toEqual([{ kind: 'saved', revision: 7 }]);
    }
    unsubscribe();
    // Отписка закрывает канал; повторный post не должен бросать.
    expect(() => channel.post({ kind: 'cleared', revision: 1 })).not.toThrow();
  });

  it('exposes the subscription through the repository port', async () => {
    const repository = new IndexedDbMatchRepository();
    const unsubscribe = repository.onExternalChange(() => undefined);
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
  });
});
