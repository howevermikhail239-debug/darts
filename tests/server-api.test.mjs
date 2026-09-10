/* global process, fetch */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const start = async (file) => {
  const port = 44000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['server.mjs'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), DARTS_DATA_FILE: file }, stdio: 'pipe' });
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
