import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DB_VERSION,
  IndexedDbLastSetupRepository,
  IndexedDbMatchRepository,
  IndexedDbSharedRepository,
  LocalSettingsRepository,
  clearLocalData,
} from '../src/infrastructure/persistence/IndexedDbRepositories';
import { createMatch } from '../src/domain/match/createMatch';
import { emptyDraft } from '../src/domain/match/VisitDraft';
import type { Match } from '../src/domain/match/models';

const DB_NAME = 'dart-scorekeeper';
const token = 'legacy-token';
const finished = (id: string, createdAt: string): Match => {
  const base = createMatch(
    id,
    ['a', 'b'],
    { mode: 'x01', format: { kind: 'unlimited' }, startingPlayerIndex: 0 },
    createdAt,
  );
  return { ...base, status: 'completed', completedAt: createdAt, winnerId: 'a' };
};
const lastSetup = {
  participants: [{ name: 'Анна' }, { name: 'Борис' }],
  setup: {
    mode: 'x01',
    startingScore: 501,
    outRule: 'straight',
    format: { kind: 'unlimited' },
    startingPlayerIndex: 0,
  },
};

/** Создаёт базу версии 1 ровно в той форме, в какой она есть у существующих пользователей. */
async function seedVersionOne(): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('matches', { keyPath: 'id' });
      request.result.createObjectStore('players', { keyPath: 'id' });
      request.result.createObjectStore('meta');
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(['matches', 'players', 'meta'], 'readwrite');
    const meta = transaction.objectStore('meta');
    transaction.objectStore('players').put({ id: 'a', name: 'Анна', createdAt: '2026-09-01T10:00:00.000Z' });
    transaction.objectStore('matches').put(finished('local-history', '2026-09-02T10:00:00.000Z'));
    // Шесть видов записей в сторе meta — все, что были в версии 1.
    meta.put(
      {
        schemaVersion: 3,
        current: createMatch(
          'active',
          ['a', 'b'],
          { mode: 'x01', format: { kind: 'unlimited' }, startingPlayerIndex: 0 },
          '2026-09-03T10:00:00.000Z',
        ),
        draft: { playerId: 'a', draft: emptyDraft() },
        companyToken: token,
      },
      'activeMatch',
    );
    meta.put({ theme: 'dark' }, 'settings');
    meta.put({ kind: 'company', token, name: 'Лига', createdAt: '2026-09-01T09:00:00.000Z' }, `company:${token}`);
    meta.put([{ id: 'p1', name: 'Миша', createdAt: '2026-09-01T09:30:00.000Z' }], `players:${token}`);
    meta.put(
      { token, match: finished('company-pending', '2026-09-04T10:00:00.000Z'), state: 'pending' },
      `match:${token}:company-pending`,
    );
    meta.put(
      { token, match: finished('company-synced', '2026-09-05T10:00:00.000Z'), state: 'synced' },
      `match:${token}:company-synced`,
    );
    meta.put(lastSetup, 'lastSetup:local');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

const metaKeys = async (): Promise<string[]> => {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  const keys = await new Promise<string[]>((resolve, reject) => {
    const request = database.transaction('meta').objectStore('meta').getAllKeys();
    request.onsuccess = () => resolve(request.result.map(String));
    request.onerror = () => reject(request.error);
  });
  database.close();
  return keys.sort();
};

describe('IndexedDB schema v1 -> v2 migration', () => {
  afterEach(() => clearLocalData());

  it('moves every company record out of the meta dump and keeps the rest untouched', async () => {
    await seedVersionOne();

    const shared = new IndexedDbSharedRepository();
    const matches = new IndexedDbMatchRepository();

    expect(await shared.companies()).toEqual([{ token, name: 'Лига', createdAt: '2026-09-01T09:00:00.000Z' }]);
    expect((await shared.players(token)).map((player) => player.name)).toEqual(['Миша']);
    expect(
      (await shared.matches(token))
        .map((item) => ({ id: item.matchId, state: item.state }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    ).toEqual([
      { id: 'company-pending', state: 'pending' },
      { id: 'company-synced', state: 'synced' },
    ]);

    // activeMatch, settings и lastSetup:* остаются в meta.
    const active = await matches.loadActive();
    expect(active?.current.id).toBe('active');
    expect(active?.companyToken).toBe(token);
    expect(await new LocalSettingsRepository().load()).toEqual({ theme: 'dark' });
    expect(await new IndexedDbLastSetupRepository().load('local')).toMatchObject({
      participants: [{ name: 'Анна' }, { name: 'Борис' }],
    });
    expect((await matches.listHistory()).map((match) => match.id)).toEqual(['local-history']);
    expect(await metaKeys()).toEqual(['activeMatch', 'lastSetup:local', 'settings']);
  });

  it('survives a second open at the new version without losing or duplicating anything', async () => {
    await seedVersionOne();
    const shared = new IndexedDbSharedRepository();
    expect(await shared.companies()).toHaveLength(1);

    // Повторное открытие на той же версии не должно запускать апгрейд ещё раз.
    let upgraded = false;
    const reopenedRaw = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        upgraded = true;
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    reopenedRaw.close();
    expect(upgraded).toBe(false);

    const reopened = new IndexedDbSharedRepository();
    expect(await reopened.companies()).toHaveLength(1);
    expect(await reopened.matches(token)).toHaveLength(2);
    expect(await metaKeys()).toEqual(['activeMatch', 'lastSetup:local', 'settings']);
    expect(DB_VERSION).toBe(2);
  });

  it('creates a fresh database at the current version when nothing existed', async () => {
    const shared = new IndexedDbSharedRepository();
    expect(await shared.companies()).toEqual([]);
    expect(await new IndexedDbMatchRepository().listHistory()).toEqual([]);
  });
});
