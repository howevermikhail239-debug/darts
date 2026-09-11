/* global process, fetch, Buffer, setTimeout */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, readdir, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { once } from 'node:events';

const start = async (file, env = {}) => {
  const port = 44000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      LOG_LEVEL: 'error',
      ...(file ? { DARTS_DATA_FILE: file } : {}),
      ...env,
    },
    stdio: 'pipe',
  });
  child.stderr.resume();
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (data) => data.toString().includes('Dart Scorekeeper') && resolve());
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`server exited: ${code}`)));
  });
  return { child, port, url: `http://127.0.0.1:${port}` };
};

const stop = (child) =>
  new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once('exit', resolve);
    child.kill();
  });

const json = async (url, options) => {
  const response = await fetch(url, options);
  return { status: response.status, body: await response.json(), headers: response.headers };
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const jsonPut = (body) => ({
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const jsonPost = (body) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

const match = (id) => ({
  id,
  createdAt: '2026-09-10T10:00:00.000Z',
  completedAt: '2026-09-10T10:01:00.000Z',
  status: 'abandoned',
  players: ['player-a', 'temporary-b'],
  startingPlayerIndex: 0,
  currentPlayerIndex: 0,
  participantNames: { 'player-a': 'Миша', 'temporary-b': 'Игрок 2' },
  confirmedVisits: [],
  state: {
    kind: 'x01',
    startingScore: 501,
    outRule: 'straight',
    format: { kind: 'unlimited' },
    remaining: { 'player-a': 501, 'temporary-b': 501 },
    visitsCompleted: { 'player-a': 0, 'temporary-b': 0 },
    phase: { kind: 'regulation' },
  },
});

/** Sends a raw request, optionally splitting the body at an exact byte offset. */
const rawRequest = async (port, { method = 'PUT', path, body = '', headers = {}, splitAt = null }) => {
  const payload = Buffer.from(body, 'utf8');
  const lines = [
    `${method} ${path} HTTP/1.1`,
    'Host: 127.0.0.1',
    'Connection: close',
    `Content-Length: ${payload.length}`,
    ...Object.entries({ 'Content-Type': 'application/json', ...headers }).map(([k, v]) => `${k}: ${v}`),
  ];
  const head = Buffer.from(`${lines.join('\r\n')}\r\n\r\n`, 'utf8');
  const socket = connect(port, '127.0.0.1');
  await once(socket, 'connect');
  if (splitAt === null) {
    socket.write(Buffer.concat([head, payload]));
  } else {
    socket.write(Buffer.concat([head, payload.subarray(0, splitAt)]));
    await delay(25);
    socket.write(payload.subarray(splitAt));
  }
  const chunks = [];
  for await (const chunk of socket) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  const separator = text.indexOf('\r\n\r\n');
  const head_ = text.slice(0, separator);
  return {
    status: Number(head_.split('\r\n')[0].split(' ')[1]),
    headers: head_.toLowerCase(),
    body: text.slice(separator + 4),
  };
};

test('companies isolate data, preserve stable players and idempotent immutable matches after restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'darts-server-'));
  const file = join(dir, 'store.json');
  let server;
  try {
    server = await start(file);
    const manifest = await fetch(`${server.url}/manifest.webmanifest`);
    assert.equal(manifest.status, 200);
    assert.match(manifest.headers.get('content-type') ?? '', /^application\/manifest\+json/);
    assert.equal(manifest.headers.get('cache-control'), 'no-cache');
    const index = await fetch(`${server.url}/`);
    assert.equal(index.headers.get('cache-control'), 'no-cache');
    const indexText = await index.text();
    const assetPath = indexText.match(/\/assets\/[^"']+\.js/)?.[0];
    assert.ok(assetPath);
    assert.equal(
      (await fetch(`${server.url}${assetPath}`)).headers.get('cache-control'),
      'public, max-age=31536000, immutable',
    );
    const a = await json(`${server.url}/api/groups`, jsonPost({ name: 'Дартс' }));
    const b = await json(`${server.url}/api/groups`, jsonPost({ name: 'Другая' }));
    assert.equal(a.status, 201);
    assert.match(a.body.token, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(a.body.token, b.body.token);
    const player = await json(`${server.url}/api/groups/${a.body.token}/players`, jsonPost({ name: 'Миша' }));
    assert.equal(player.status, 201);
    assert.deepEqual(
      (await json(`${server.url}/api/groups/${a.body.token}/players`)).body.players[0],
      player.body.player,
    );
    assert.equal((await json(`${server.url}/api/groups/${b.body.token}/players`)).body.players.length, 0);
    const item = match('match-1');
    const put = jsonPut(item);
    assert.equal((await json(`${server.url}/api/groups/${a.body.token}/matches/match-1`, put)).status, 201);
    assert.equal((await json(`${server.url}/api/groups/${a.body.token}/matches/match-1`, put)).status, 200);
    // Last writer wins without a precondition, and no byte-level false conflict.
    const changed = await json(
      `${server.url}/api/groups/${a.body.token}/matches/match-1`,
      jsonPut({ ...item, completedAt: 'different' }),
    );
    assert.equal(changed.status, 200);
    assert.equal(changed.body.revision, 2);
    assert.equal((await json(`${server.url}/api/groups/${b.body.token}/matches/match-1`, put)).status, 201);
    assert.equal((await json(`${server.url}/api/groups/no-such-token`)).status, 404);
    assert.equal(
      (await json(`${server.url}/api/groups/${a.body.token}/matches/bad`, jsonPut({ id: 'bad' }))).status,
      400,
    );
    assert.equal((await json(`${server.url}/api/groups/${a.body.token}/players`, jsonPost('{bad'))).status, 400);
    assert.equal((await fetch(`${server.url}/api/groups`, jsonPost({ name: 'x'.repeat(600_000) }))).status, 413);
    assert.equal((await fetch(`${server.url}/data/dart-scorekeeper.json`)).status, 404);
    assert.equal((await fetch(`${server.url}/%2e%2e/server.mjs`)).status, 404);
    assert.equal((await fetch(`${server.url}/data/%2e%2e/server.mjs`)).status, 404);
    const writes = Array.from({ length: 12 }, (_, index) =>
      json(
        `${server.url}/api/groups/${a.body.token}/matches/concurrent-${index}`,
        jsonPut(match(`concurrent-${index}`)),
      ),
    );
    assert.ok((await Promise.all(writes)).every((result) => result.status === 201));
    const storedText = await readFile(file, 'utf8');
    assert.equal(storedText.includes(a.body.token), false);
    await stop(server.child);
    server = await start(file);
    const restored = await json(`${server.url}/api/groups/${a.body.token}`);
    assert.equal(restored.body.players[0].id, player.body.player.id);
    assert.equal(restored.body.matches.length, 13);
    // The stored revision never leaks into the match objects handed to clients.
    assert.ok(restored.body.matches.every((stored) => stored.revision === undefined && typeof stored.id === 'string'));
  } finally {
    if (server) await stop(server.child);
    await rm(dir, { recursive: true, force: true });
  }
});

test('DATA_DIR selects a writable storage directory and health reports readiness', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'darts-data-dir-'));
  let server;
  try {
    server = await start(undefined, { DATA_DIR: dir, DARTS_DATA_FILE: '' });
    const health = await json(`${server.url}/healthz`);
    assert.equal(health.status, 200);
    assert.equal(health.body.status, 'ok');
    assert.equal(typeof health.body.revision, 'string');
    assert.equal((await json(`${server.url}/api/groups`, jsonPost({ name: 'Production' }))).status, 201);
    const stored = JSON.parse(await readFile(join(dir, 'dart-scorekeeper.json'), 'utf8'));
    assert.equal(Object.keys(stored.groups).length, 1);
  } finally {
    if (server) await stop(server.child);
    await rm(dir, { recursive: true, force: true });
  }
});

test('profile management and match deletion are atomic, idempotent, and survive restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'darts-mutations-'));
  const file = join(dir, 'store.json');
  let server;
  try {
    server = await start(file);
    const created = await json(`${server.url}/api/groups`, jsonPost('{}'));
    const token = created.body.token;
    const player = await json(`${server.url}/api/groups/${token}/players`, jsonPost({ name: ' Миша ' }));
    const id = player.body.player.id;
    const historical = {
      ...match('history'),
      players: [id, 'temporary-b'],
      participantNames: { [id]: 'Миша', 'temporary-b': 'Гость' },
    };
    assert.equal((await json(`${server.url}/api/groups/${token}/matches/history`, jsonPut(historical))).status, 201);
    const renamed = await json(`${server.url}/api/groups/${token}/players/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: ' Михаил ' }),
    });
    assert.equal(renamed.body.player.id, id);
    assert.equal(renamed.body.player.name, 'Михаил');
    const reset = await json(`${server.url}/api/groups/${token}/players/${id}/statistics-reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    assert.match(reset.body.player.statsResetAt, /^2026-/);
    assert.equal((await json(`${server.url}/api/groups/${token}/matches/history`, { method: 'DELETE' })).status, 200);
    assert.equal((await json(`${server.url}/api/groups/${token}/matches/history`, { method: 'DELETE' })).status, 200);
    assert.equal((await json(`${server.url}/api/groups/${token}/players/${id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await json(`${server.url}/api/groups/${token}/players/${id}`, { method: 'DELETE' })).status, 200);
    await stop(server.child);
    server = await start(file);
    const snapshot = await json(`${server.url}/api/groups/${token}`);
    assert.deepEqual(snapshot.body.players, []);
    assert.deepEqual(snapshot.body.matches, []);
  } finally {
    if (server) await stop(server.child);
    await rm(dir, { recursive: true, force: true });
  }
});

test('health reports unavailable without replacing corrupt storage', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'darts-corrupt-'));
  const file = join(dir, 'dart-scorekeeper.json');
  let server;
  try {
    await writeFile(file, '{corrupt', 'utf8');
    server = await start(file, { DARTS_STORAGE_PROBE_MS: '100' });
    const health = await json(`${server.url}/healthz`);
    assert.equal(health.status, 503);
    assert.equal(health.body.status, 'unavailable');
    assert.equal(typeof health.body.revision, 'string');
    assert.equal((await json(`${server.url}/api/groups`, jsonPost('{}'))).status, 503);
    // Corrupt storage is never healed automatically: the probe must not overwrite it.
    await delay(400);
    assert.equal((await json(`${server.url}/healthz`)).status, 503);
    assert.equal(await readFile(file, 'utf8'), '{corrupt');
  } finally {
    if (server) await stop(server.child);
    await rm(dir, { recursive: true, force: true });
  }
});

test('runtime persistence failure returns 503 without committing phantom state', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'darts-runtime-failure-'));
  const dataDir = join(rootDir, 'data');
  const file = join(dataDir, 'store.json');
  const durableCopy = join(rootDir, 'durable.json');
  let server;
  try {
    server = await start(file);
    const created = await json(`${server.url}/api/groups`, jsonPost({ name: 'Durable' }));
    assert.equal(created.status, 201);
    await rename(file, durableCopy);
    await rm(dataDir, { recursive: true });
    await writeFile(dataDir, 'blocks-directory-creation', 'utf8');
    const failed = await json(
      `${server.url}/api/groups/${created.body.token}/players`,
      jsonPost({ name: 'Not persisted' }),
    );
    assert.equal(failed.status, 503);
    assert.deepEqual(failed.body, { error: 'unavailable' });
    const health = await json(`${server.url}/healthz`);
    assert.equal(health.status, 503);
    assert.equal(health.body.status, 'unavailable');
    assert.equal(typeof health.body.revision, 'string');
    // Reads stay available while the storage is degraded.
    const readable = await json(`${server.url}/api/groups/${created.body.token}`);
    assert.equal(readable.status, 200);
    assert.deepEqual(readable.body.players, []);
    const durable = JSON.parse(await readFile(durableCopy, 'utf8'));
    assert.equal(
      Object.values(durable.groups)[0].players && Object.keys(Object.values(durable.groups)[0].players).length,
      0,
    );
  } finally {
    if (server) await stop(server.child);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('a multi-byte body split across TCP chunks round-trips unchanged', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'darts-utf8-'));
  const file = join(dir, 'store.json');
  let server;
  try {
    server = await start(file);
    const created = await json(`${server.url}/api/groups`, jsonPost({ name: 'UTF8' }));
    const token = created.body.token;
    const note = 'Пётр Первый бросил дротик — 180! '.repeat(2200);
    assert.ok(Buffer.byteLength(note, 'utf8') > 64 * 1024);
    const payload = { ...match('utf8-match'), participantNames: { 'player-a': note, 'temporary-b': 'Игрок 2' } };
    const body = JSON.stringify(payload);
    const bytes = Buffer.from(body, 'utf8');
    // Split exactly in the middle of a two-byte character, at an offset beyond one 64 KB chunk.
    let splitAt = 0;
    for (let index = 70 * 1024; index < bytes.length; index += 1) {
      if (bytes[index] >= 0xd0 && bytes[index] <= 0xd3) {
        splitAt = index + 1;
        break;
      }
    }
    assert.ok(splitAt > 70 * 1024);
    const response = await rawRequest(server.port, { path: `/api/groups/${token}/matches/utf8-match`, body, splitAt });
    assert.equal(response.status, 201);
    const stored = (await json(`${server.url}/api/groups/${token}/matches`)).body.matches[0];
    assert.equal(stored.participantNames['player-a'], note);
    assert.equal(JSON.stringify(stored).includes('�'), false);
    assert.equal((await readFile(file, 'utf8')).includes('�'), false);
  } finally {
    if (server) await stop(server.child);
    await rm(dir, { recursive: true, force: true });
  }
});

test('identical payloads never conflict regardless of TCP framing or key order', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'darts-conflict-'));
  const file = join(dir, 'store.json');
  let server;
  try {
    server = await start(file);
    const created = await json(`${server.url}/api/groups`, jsonPost({ name: 'Конфликты' }));
    const token = created.body.token;
    const payload = { ...match('framing'), participantNames: { 'player-a': 'Ёлка', 'temporary-b': 'Игрок 2' } };
    const body = JSON.stringify(payload);
    const bytes = Buffer.from(body, 'utf8');
    const cyrillic = bytes.findIndex((value) => value === 0xd0 || value === 0xd1);
    assert.ok(cyrillic > 0);
    const path = `/api/groups/${token}/matches/framing`;
    assert.equal((await rawRequest(server.port, { path, body, splitAt: cyrillic })).status, 201);
    assert.equal((await rawRequest(server.port, { path, body, splitAt: cyrillic + 1 })).status, 200);
    assert.equal((await rawRequest(server.port, { path, body, splitAt: null })).status, 200);
    // Reordered keys describe the same match and must not be reported as a conflict.
    const reordered = Object.fromEntries(Object.entries(payload).reverse());
    reordered.state = Object.fromEntries(Object.entries(payload.state).reverse());
    assert.notEqual(JSON.stringify(reordered), body);
    const shuffled = await json(`${server.url}${path}`, jsonPut(reordered));
    assert.equal(shuffled.status, 200);
    assert.equal(shuffled.body.revision, 1);
    // An explicit precondition still detects a real divergence.
    const stale = await json(`${server.url}${path}`, {
      ...jsonPut({ ...payload, completedAt: '2026-09-10T11:00:00.000Z' }),
      headers: { 'content-type': 'application/json', 'if-match': '17' },
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.revision, 1);
    assert.equal(stale.body.match.completedAt, payload.completedAt);
    const accepted = await json(`${server.url}${path}`, {
      ...jsonPut({ ...payload, completedAt: '2026-09-10T11:00:00.000Z' }),
      headers: { 'content-type': 'application/json', 'if-match': '1' },
    });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.revision, 2);
  } finally {
    if (server) await stop(server.child);
    await rm(dir, { recursive: true, force: true });
  }
});

test('storage recovers by itself once the write failure is gone', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'darts-recovery-'));
  const dataDir = join(rootDir, 'data');
  const file = join(dataDir, 'store.json');
  let server;
  try {
    server = await start(file, { DARTS_STORAGE_PROBE_MS: '100' });
    const created = await json(`${server.url}/api/groups`, jsonPost({ name: 'Recovery' }));
    assert.equal(created.status, 201);
    await rm(dataDir, { recursive: true });
    await writeFile(dataDir, 'blocks-directory-creation', 'utf8');
    assert.equal(
      (await json(`${server.url}/api/groups/${created.body.token}/players`, jsonPost({ name: 'Ghost' }))).status,
      503,
    );
    assert.equal((await json(`${server.url}/healthz`)).status, 503);
    await rm(dataDir, { force: true });
    await mkdir(dataDir, { recursive: true });
    let healthy = 0;
    for (let attempt = 0; attempt < 100 && healthy !== 200; attempt += 1) {
      await delay(100);
      healthy = (await json(`${server.url}/healthz`)).status;
    }
    assert.equal(healthy, 200);
    const player = await json(
      `${server.url}/api/groups/${created.body.token}/players`,
      jsonPost({ name: 'Восстановлен' }),
    );
    assert.equal(player.status, 201);
    const stored = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(Object.keys(Object.values(stored.groups)[0].players).length, 1);
  } finally {
    if (server) await stop(server.child);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('quotas are refused with explicit codes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'darts-quota-'));
  const file = join(dir, 'store.json');
  let server;
  try {
    server = await start(file, { DARTS_MAX_MATCHES_PER_GROUP: '2', DARTS_MAX_PLAYERS_PER_GROUP: '1' });
    const created = await json(`${server.url}/api/groups`, jsonPost({ name: 'Квоты' }));
    const token = created.body.token;
    const visits = await json(
      `${server.url}/api/groups/${token}/matches/visits`,
      jsonPut({ ...match('visits'), confirmedVisits: Array.from({ length: 5001 }, () => 0) }),
    );
    assert.equal(visits.status, 413);
    assert.equal(visits.body.error, 'too_many_visits');
    const huge = { ...match('huge'), participantNames: { 'player-a': 'Я'.repeat(140_000), 'temporary-b': 'Б' } };
    const large = await json(`${server.url}/api/groups/${token}/matches/huge`, jsonPut(huge));
    assert.equal(large.status, 413);
    assert.equal(large.body.error, 'match_too_large');
    assert.equal((await json(`${server.url}/api/groups/${token}/matches/m1`, jsonPut(match('m1')))).status, 201);
    assert.equal((await json(`${server.url}/api/groups/${token}/matches/m2`, jsonPut(match('m2')))).status, 201);
    const third = await json(`${server.url}/api/groups/${token}/matches/m3`, jsonPut(match('m3')));
    assert.equal(third.status, 409);
    assert.equal(third.body.error, 'too_many_matches');
    assert.equal((await json(`${server.url}/api/groups/${token}/players`, jsonPost({ name: 'Первый' }))).status, 201);
    const extra = await json(`${server.url}/api/groups/${token}/players`, jsonPost({ name: 'Второй' }));
    assert.equal(extra.status, 409);
    assert.equal(extra.body.error, 'too_many_players');
    // A structurally inconsistent match is refused as well.
    const inconsistent = await json(
      `${server.url}/api/groups/${token}/matches/bad-winner`,
      jsonPut({ ...match('bad-winner'), winnerId: 'nobody' }),
    );
    assert.equal(inconsistent.status, 400);
    assert.equal(inconsistent.body.error, 'invalid_match');
  } finally {
    if (server) await stop(server.child);
    await rm(dir, { recursive: true, force: true });
  }
});

test('company creation is rate limited per address', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'darts-rate-'));
  const file = join(dir, 'store.json');
  let server;
  try {
    server = await start(file);
    for (let index = 0; index < 5; index += 1) {
      assert.equal((await json(`${server.url}/api/groups`, jsonPost({ name: `Компания ${index}` }))).status, 201);
    }
    const limited = await json(`${server.url}/api/groups`, jsonPost({ name: 'Лишняя' }));
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error, 'rate_limited');
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
    // A different forwarded address keeps its own budget.
    const other = await fetch(`${server.url}/api/groups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7, 10.0.0.1' },
      body: '{}',
    });
    assert.equal(other.status, 201);
  } finally {
    if (server) await stop(server.child);
    await rm(dir, { recursive: true, force: true });
  }
});

test('prototype keys are not addressable and never reach the disk', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'darts-proto-'));
  const file = join(dir, 'store.json');
  let server;
  try {
    server = await start(file);
    const created = await json(`${server.url}/api/groups`, jsonPost({ name: 'Прототипы' }));
    const token = created.body.token;
    for (const key of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
      const encoded = encodeURIComponent(key);
      assert.equal(
        (
          await json(`${server.url}/api/groups/${token}/players/${encoded}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Ghost' }),
          })
        ).status,
        404,
        `PATCH ${key}`,
      );
      assert.equal(
        (
          await json(`${server.url}/api/groups/${token}/players/${encoded}/statistics-reset`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
          })
        ).status,
        404,
        `reset ${key}`,
      );
      assert.equal(
        (await json(`${server.url}/api/groups/${token}/players/${encoded}`, { method: 'DELETE' })).status,
        404,
        `DELETE player ${key}`,
      );
      assert.equal(
        (await json(`${server.url}/api/groups/${token}/matches/${encoded}`, jsonPut({ ...match(key), id: key })))
          .status,
        404,
        `PUT ${key}`,
      );
      assert.equal(
        (await json(`${server.url}/api/groups/${token}/matches/${encoded}`, { method: 'DELETE' })).status,
        404,
        `DELETE match ${key}`,
      );
    }
    const snapshot = await json(`${server.url}/api/groups/${token}`);
    assert.deepEqual(snapshot.body.players, []);
    assert.deepEqual(snapshot.body.matches, []);
    const stored = JSON.parse(await readFile(file, 'utf8'));
    const group = Object.values(stored.groups)[0];
    assert.deepEqual(Object.keys(group.players), []);
    assert.deepEqual(Object.keys(group.matches), []);
    assert.equal((await readFile(file, 'utf8')).includes('constructor'), false);
  } finally {
    if (server) await stop(server.child);
    await rm(dir, { recursive: true, force: true });
  }
});

test('SIGTERM drains the in-flight request and leaves no temporary files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'darts-shutdown-'));
  const file = join(dir, 'store.json');
  let server;
  try {
    server = await start(file);
    assert.equal((await json(`${server.url}/api/groups`, jsonPost({ name: 'Первая' }))).status, 201);
    const body = JSON.stringify({ name: 'Во время остановки' });
    const payload = Buffer.from(body, 'utf8');
    const socket = connect(server.port, '127.0.0.1');
    await once(socket, 'connect');
    socket.write(
      `POST /api/groups HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: ${payload.length}\r\n\r\n`,
    );
    socket.write(payload.subarray(0, 5));
    await delay(50);
    server.child.kill('SIGTERM');
    await delay(150);
    socket.write(payload.subarray(5));
    const chunks = [];
    for await (const chunk of socket) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString('utf8');
    assert.match(text, /^HTTP\/1\.1 201/);
    const [code] = await once(server.child, 'exit');
    assert.equal(code, 0);
    assert.deepEqual(
      (await readdir(dir)).filter((name) => name.endsWith('.tmp')),
      [],
    );
    const stored = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(Object.keys(stored.groups).length, 2);
  } finally {
    if (server) await stop(server.child);
    await rm(dir, { recursive: true, force: true });
  }
});

test('security headers are present on API and static responses', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'darts-headers-'));
  const file = join(dir, 'store.json');
  let server;
  try {
    server = await start(file);
    const expected = {
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'strict-transport-security': 'max-age=31536000',
      'x-frame-options': 'DENY',
    };
    for (const path of ['/healthz', '/', '/manifest.webmanifest', '/no-such-page']) {
      const response = await fetch(`${server.url}${path}`);
      for (const [header, value] of Object.entries(expected)) {
        assert.equal(response.headers.get(header), value, `${path} ${header}`);
      }
      const csp = response.headers.get('content-security-policy') ?? '';
      assert.match(csp, /default-src 'self'/);
      assert.match(csp, /frame-ancestors 'none'/);
      assert.match(csp, /worker-src 'self'/);
      await response.arrayBuffer();
    }
    // Unknown extensions are never served as HTML.
    assert.equal((await fetch(`${server.url}/sw.js`)).headers.get('content-type'), 'text/javascript; charset=utf-8');
    const fallback = await fetch(`${server.url}/history`);
    assert.equal(fallback.headers.get('content-type'), 'text/html; charset=utf-8');
    await fallback.arrayBuffer();
  } finally {
    if (server) await stop(server.child);
    await rm(dir, { recursive: true, force: true });
  }
});

test('bodies must be declared as JSON', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'darts-content-type-'));
  const file = join(dir, 'store.json');
  let server;
  try {
    server = await start(file);
    const plain = await json(`${server.url}/api/groups`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    });
    assert.equal(plain.status, 415);
    assert.equal(plain.body.error, 'unsupported_media_type');
    assert.equal((await fetch(`${server.url}/api/groups`, { method: 'POST', body: '{}' })).status, 415);
    const charset = await json(`${server.url}/api/groups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: '{}',
    });
    assert.equal(charset.status, 201);
  } finally {
    if (server) await stop(server.child);
    await rm(dir, { recursive: true, force: true });
  }
});

test('an oversized body does not poison the following requests', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'darts-oversized-'));
  const file = join(dir, 'store.json');
  let server;
  try {
    server = await start(file);
    const created = await json(`${server.url}/api/groups`, jsonPost({ name: 'Keepalive' }));
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const oversized = await fetch(
        `${server.url}/api/groups/${created.body.token}/matches/big`,
        jsonPut({ ...match('big'), participantNames: { 'player-a': 'Я'.repeat(400_000), 'temporary-b': 'Б' } }),
      );
      assert.equal(oversized.status, 413);
      assert.equal((await oversized.json()).error, 'too_large');
      assert.equal((await json(`${server.url}/healthz`)).status, 200);
      assert.equal((await fetch(`${server.url}/%2e%2e/server.mjs`)).status, 404);
      assert.equal((await json(`${server.url}/api/groups/${created.body.token}`)).status, 200);
    }
    const raw = await rawRequest(server.port, {
      path: `/api/groups/${created.body.token}/matches/big`,
      body: JSON.stringify({
        ...match('big'),
        participantNames: { 'player-a': 'Я'.repeat(400_000), 'temporary-b': 'Б' },
      }),
    });
    assert.equal(raw.status, 413);
    assert.match(raw.headers, /connection: close/);
  } finally {
    if (server) await stop(server.child);
    await rm(dir, { recursive: true, force: true });
  }
});
