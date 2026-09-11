import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpCompanyGateway, MAX_UPLOAD_BYTES } from '../src/infrastructure/network/HttpCompanyGateway';
import { HttpError } from '../src/application/ports/companyGateway';
import { createMatch } from '../src/domain/match/createMatch';
import type { Match } from '../src/domain/match/models';

const base = createMatch(
  'remote',
  ['a', 'b'],
  { mode: 'x01', format: { kind: 'unlimited' }, startingPlayerIndex: 0 },
  '2026-09-11T12:00:00.000Z',
);
const valid: Match = { ...base, status: 'completed', completedAt: '2026-09-11T12:30:00.000Z', winnerId: 'a' };
const response = (matches: readonly unknown[], players: readonly unknown[] = []) => ({
  group: { name: 'Лига', createdAt: '2026-09-11T12:00:00.000Z' },
  players,
  matches,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const corruptions: readonly (readonly [string, (match: Match) => unknown])[] = [
  ['missing state', (match) => Object.fromEntries(Object.entries(match).filter(([key]) => key !== 'state'))],
  ['unknown state', (match) => ({ ...match, state: { kind: 'unknown' } })],
  ['invalid players', (match) => ({ ...match, players: [] })],
  ['invalid winner', (match) => ({ ...match, winnerId: 'outsider' })],
  ['invalid current player', (match) => ({ ...match, currentPlayerIndex: 99 })],
  ['missing X01 remaining', (match) => ({ ...match, state: { ...match.state, remaining: { a: 501 } } })],
  ['unsupported schema', (match) => ({ ...match, state: { ...match.state, format: { kind: 'future' } } })],
  ['still in progress', (match) => ({ ...match, status: 'in_progress' })],
];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Возвращает ошибку операции, а не её результат: тесты проверяют именно отказы. */
const failureOf = (run: () => Promise<unknown>): Promise<HttpError> =>
  run().then(
    () => {
      throw new Error('ожидался отказ, но операция завершилась успешно');
    },
    (error: unknown) => error as HttpError,
  );

describe('HttpCompanyGateway remote match validation', () => {
  it('accepts a complete match payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(response([valid]))),
    );
    await expect(new HttpCompanyGateway().loadCompany('token')).resolves.toMatchObject({
      matches: [{ id: 'remote' }],
      skippedMatches: 0,
    });
  });

  it.each(corruptions)('skips %s instead of bricking the whole company', async (_label, corrupt) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(response([corrupt(valid), { ...valid, id: 'good' }]))),
    );
    const snapshot = await new HttpCompanyGateway().loadCompany('token');
    expect(snapshot.matches.map((match) => match.id)).toEqual(['good']);
    expect(snapshot.skippedMatches).toBe(1);
  });

  it('migrates a legacy match created before startingScore and outRule existed', async () => {
    const legacyState = Object.fromEntries(
      Object.entries(valid.state).filter(([key]) => key !== 'startingScore' && key !== 'outRule'),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(response([{ ...valid, state: legacyState }]))),
    );
    const snapshot = await new HttpCompanyGateway().loadCompany('token');
    expect(snapshot.matches).toHaveLength(1);
    expect(snapshot.matches[0]?.state).toMatchObject({ startingScore: 501, outRule: 'straight' });
    expect(snapshot.skippedMatches).toBe(0);
  });

  it('skips a broken player without rejecting the snapshot', async () => {
    const player = { id: 'p1', name: 'Миша', createdAt: '2026-09-01T10:00:00.000Z' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(response([], [player, { id: '', name: 42 }]))),
    );
    const snapshot = await new HttpCompanyGateway().loadCompany('token');
    expect(snapshot.players).toEqual([player]);
    expect(snapshot.skippedPlayers).toBe(1);
  });

  it('rejects a structurally invalid envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ group: { name: 'Лига', createdAt: 'x' }, players: [], matches: 'nope' })),
    );
    await expect(new HttpCompanyGateway().loadCompany('token')).rejects.toThrow('некорректные данные');
  });
});

describe('HttpCompanyGateway transport', () => {
  it.each([[400], [409], [413], [500], [503]])('exposes status %i instead of one generic message', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status })),
    );
    const failure = await failureOf(() => new HttpCompanyGateway().uploadMatch('token', valid));
    expect(failure).toBeInstanceOf(HttpError);
    expect(failure.status).toBe(status);
  });

  it('marks 4xx as permanent and 5xx, 408, 429 as retryable', async () => {
    const statusOf = async (status: number) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('{}', { status })),
      );
      return await failureOf(() => new HttpCompanyGateway().uploadMatch('token', valid));
    };
    expect((await statusOf(413)).permanent).toBe(true);
    expect((await statusOf(409)).permanent).toBe(true);
    expect((await statusOf(429)).permanent).toBe(false);
    expect((await statusOf(408)).permanent).toBe(false);
    expect((await statusOf(503)).permanent).toBe(false);
  });

  it('distinguishes 409 from 500 by message', async () => {
    const messageOf = async (status: number) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('{}', { status })),
      );
      return (await failureOf(() => new HttpCompanyGateway().deleteMatch('token', 'm'))).message;
    };
    expect(await messageOf(409)).not.toBe(await messageOf(500));
    expect(await messageOf(500)).toContain('временно недоступен');
    expect(await messageOf(409)).toContain('изменились на сервере');
  });

  it('turns a non-JSON captive-portal page into a domain message, not a SyntaxError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<!doctype html><html></html>', { status: 200, headers: { 'content-type': 'text/html' } }),
      ),
    );
    await expect(new HttpCompanyGateway().loadCompany('token')).rejects.toThrow('вернул не JSON');
  });

  it('aborts a hung request by timeout instead of hanging forever', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_input: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('The operation was aborted.')));
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const pending = failureOf(() => new HttpCompanyGateway().loadCompany('token'));
    await vi.advanceTimersByTimeAsync(120_000);
    const failure = await pending;
    expect(failure.message).toContain('не ответил вовремя');
    expect(fetchMock).toHaveBeenCalled();
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeDefined();
  });

  it('retries an idempotent GET and never retries a mutating request', async () => {
    vi.useFakeTimers();
    const failing = vi.fn(async () => new Response('{}', { status: 503 }));
    vi.stubGlobal('fetch', failing);
    const read = new HttpCompanyGateway().loadCompany('token').catch(() => undefined);
    await vi.advanceTimersByTimeAsync(60_000);
    await read;
    expect(failing).toHaveBeenCalledTimes(3);

    failing.mockClear();
    const write = new HttpCompanyGateway().deleteMatch('token', 'm').catch(() => undefined);
    await vi.advanceTimersByTimeAsync(60_000);
    await write;
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it('refuses to send a match larger than the server limit without making a request', async () => {
    const fetchMock = vi.fn(async () => json({}));
    vi.stubGlobal('fetch', fetchMock);
    const huge: Match = { ...valid, participantNames: { a: 'a'.repeat(MAX_UPLOAD_BYTES), b: 'b' } };
    const failure = await failureOf(() => new HttpCompanyGateway().uploadMatch('token', huge));
    expect(failure).toBeInstanceOf(HttpError);
    expect(failure.status).toBe(413);
    expect(failure.permanent).toBe(true);
    expect(failure.message).toContain('слишком большой');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
