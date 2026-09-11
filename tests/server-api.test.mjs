/* global process, fetch */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const start = async (file, env = {}) => {
  const port = 44000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['server.mjs'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), ...(file ? { DARTS_DATA_FILE: file } : {}), ...env }, stdio: 'pipe' });
  await new Promise((resolve, reject) => { child.stdout.on('data', data => data.toString().includes('Dart Scorekeeper') && resolve()); child.once('error', reject); child.once('exit', code => reject(new Error(`server exited: ${code}`))); });
  return { child, url: `http://127.0.0.1:${port}` };
};
const stop = child => new Promise(resolve => { child.once('exit', resolve); child.kill(); });
const json = async (url, options) => { const response = await fetch(url, options); return { status: response.status, body: await response.json() }; };
const match = id => ({ id, createdAt: '2026-09-10T10:00:00.000Z', completedAt: '2026-09-10T10:01:00.000Z', status: 'abandoned', players: ['player-a', 'temporary-b'], startingPlayerIndex: 0, currentPlayerIndex: 0, participantNames: { 'player-a': 'Миша', 'temporary-b': 'Игрок 2' }, confirmedVisits: [], state: { kind: 'x01', startingScore: 501, outRule: 'straight', format: { kind: 'unlimited' }, remaining: { 'player-a': 501, 'temporary-b': 501 }, visitsCompleted: { 'player-a': 0, 'temporary-b': 0 }, phase: { kind: 'regulation' } } });

test('companies isolate data, preserve stable players and idempotent immutable matches after restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'darts-server-')); const file = join(dir, 'store.json'); let server;
  try {
    server = await start(file);
    const manifest = await fetch(`${server.url}/manifest.webmanifest`);
    assert.equal(manifest.status, 200); assert.match(manifest.headers.get('content-type') ?? '', /^application\/manifest\+json/);
    const a = await json(`${server.url}/api/groups`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Дартс' }) });
    const b = await json(`${server.url}/api/groups`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Другая' }) });
    assert.equal(a.status, 201); assert.match(a.body.token, /^[A-Za-z0-9_-]{43}$/); assert.notEqual(a.body.token, b.body.token);
    const player = await json(`${server.url}/api/groups/${a.body.token}/players`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Миша' }) });
    assert.equal(player.status, 201);
    assert.deepEqual((await json(`${server.url}/api/groups/${a.body.token}/players`)).body.players[0], player.body.player);
    assert.equal((await json(`${server.url}/api/groups/${b.body.token}/players`)).body.players.length, 0);
    const item = match('match-1'); const put = { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(item) };
    assert.equal((await json(`${server.url}/api/groups/${a.body.token}/matches/match-1`, put)).status, 201);
    assert.equal((await json(`${server.url}/api/groups/${a.body.token}/matches/match-1`, put)).status, 200);
    assert.equal((await json(`${server.url}/api/groups/${a.body.token}/matches/match-1`, { ...put, body: JSON.stringify({ ...item, completedAt: 'different' }) })).status, 409);
    assert.equal((await json(`${server.url}/api/groups/${b.body.token}/matches/match-1`, put)).status, 201);
    assert.equal((await json(`${server.url}/api/groups/no-such-token`)).status, 404);
    assert.equal((await json(`${server.url}/api/groups/${a.body.token}/matches/bad`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'bad' }) })).status, 400);
    assert.equal((await json(`${server.url}/api/groups/${a.body.token}/players`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' })).status, 400);
    assert.equal((await fetch(`${server.url}/api/groups`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x'.repeat(600_000) }) })).status, 413);
    assert.equal((await fetch(`${server.url}/data/dart-scorekeeper.json`)).status, 404);
    assert.equal((await fetch(`${server.url}/%2e%2e/server.mjs`)).status, 404);
    assert.equal((await fetch(`${server.url}/data/%2e%2e/server.mjs`)).status, 404);
    const writes = Array.from({ length: 12 }, (_, index) => json(`${server.url}/api/groups/${a.body.token}/matches/concurrent-${index}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(match(`concurrent-${index}`)) }));
    assert.ok((await Promise.all(writes)).every(result => result.status === 201));
    const storedText = await readFile(file, 'utf8'); assert.equal(storedText.includes(a.body.token), false);
    await stop(server.child); server = await start(file);
    const restored = await json(`${server.url}/api/groups/${a.body.token}`); assert.equal(restored.body.players[0].id, player.body.player.id); assert.equal(restored.body.matches.length, 13);
  } finally { if (server) await stop(server.child); await rm(dir, { recursive: true, force: true }); }
});

test('DATA_DIR selects a writable storage directory and health reports readiness', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'darts-data-dir-')); let server;
  try {
    server = await start(undefined, { DATA_DIR: dir, DARTS_DATA_FILE: '' });
    const health = await json(`${server.url}/healthz`);
    assert.deepEqual(health, { status: 200, body: { status: 'ok' } });
    assert.equal((await json(`${server.url}/api/groups`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Production' }) })).status, 201);
    const stored = JSON.parse(await readFile(join(dir, 'dart-scorekeeper.json'), 'utf8'));
    assert.equal(Object.keys(stored.groups).length, 1);
  } finally { if (server) await stop(server.child); await rm(dir, { recursive: true, force: true }); }
});

test('health reports unavailable without replacing corrupt storage', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'darts-corrupt-')); const file = join(dir, 'dart-scorekeeper.json'); let server;
  try {
    await writeFile(file, '{corrupt', 'utf8');
    server = await start(file);
    assert.deepEqual(await json(`${server.url}/healthz`), { status: 503, body: { status: 'unavailable' } });
    assert.equal((await json(`${server.url}/api/groups`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 503);
    assert.equal(await readFile(file, 'utf8'), '{corrupt');
  } finally { if (server) await stop(server.child); await rm(dir, { recursive: true, force: true }); }
});

test('runtime persistence failure returns 503 without committing phantom state', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'darts-runtime-failure-')); const dataDir = join(rootDir, 'data'); const file = join(dataDir, 'store.json'); const durableCopy = join(rootDir, 'durable.json'); let server;
  try {
    server = await start(file);
    const created = await json(`${server.url}/api/groups`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Durable' }) });
    assert.equal(created.status, 201);
    await rename(file, durableCopy);
    await rm(dataDir, { recursive: true });
    await writeFile(dataDir, 'blocks-directory-creation', 'utf8');
    const failed = await json(`${server.url}/api/groups/${created.body.token}/players`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Not persisted' }) });
    assert.deepEqual(failed, { status: 503, body: { error: 'unavailable' } });
    assert.deepEqual(await json(`${server.url}/healthz`), { status: 503, body: { status: 'unavailable' } });
    const durable = JSON.parse(await readFile(durableCopy, 'utf8'));
    assert.equal(Object.values(durable.groups)[0].players && Object.keys(Object.values(durable.groups)[0].players).length, 0);
  } finally { if (server) await stop(server.child); await rm(rootDir, { recursive: true, force: true }); }
});
