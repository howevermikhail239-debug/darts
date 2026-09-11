/* global process, URL, console, structuredClone */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rename, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve, sep, extname } from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
const dataDir = process.env.DATA_DIR || join(root, 'data');
const dataFile = process.env.DARTS_DATA_FILE || join(dataDir, 'dart-scorekeeper.json');
let buildRevision = 'unknown';
try { const version = JSON.parse(await readFile(join(dist, 'version.json'), 'utf8')); if (typeof version.revision === 'string') buildRevision = version.revision; } catch { /* A missing identifier remains visible as unknown. */ }
let writing = Promise.resolve();
let data = { version: 1, groups: {} };
let storageError = false;
try {
  await mkdir(dirname(dataFile), { recursive: true });
  await access(dirname(dataFile), constants.R_OK | constants.W_OK);
  try { data = JSON.parse(await readFile(dataFile, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
} catch { storageError = true; }
const tokenHash = t => createHash('sha256').update(t).digest('hex');
const transact = mutate => {
  const operation = writing.then(async () => {
    if (storageError) throw new Error('storage_unavailable');
    const next = structuredClone(data);
    const result = mutate(next);
    if (result?.commit === false) return result.value;
    try {
      await mkdir(dirname(dataFile), { recursive: true });
      const tmp = `${dataFile}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(next), 'utf8');
      await rename(tmp, dataFile);
    } catch {
      storageError = true;
      throw new Error('storage_unavailable');
    }
    data = next;
    return result?.value;
  });
  writing = operation.catch(() => {});
  return operation;
};
const send = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const readJson = async req => { let size = 0, body = ''; for await (const c of req) { size += c.length; if (size > 512 * 1024) throw new Error('too_large'); body += c; } try { return JSON.parse(body || '{}'); } catch { throw new Error('bad_json'); } };
const group = token => data.groups[tokenHash(token)];
const validName = x => typeof x === 'string' && x.trim().length > 0 && x.trim().length <= 80;
const validMatch = x => x && typeof x === 'object' && typeof x.id === 'string' && x.id.length > 0 && x.id.length <= 160 && ['completed','abandoned'].includes(x.status) && Array.isArray(x.players) && x.players.length >= 2 && x.players.length <= 8 && Array.isArray(x.confirmedVisits) && x.state && typeof x.state === 'object';
const mime = p => p.endsWith('.js') ? 'text/javascript' : p.endsWith('.css') ? 'text/css' : p.endsWith('.webmanifest') ? 'application/manifest+json' : p.endsWith('.json') ? 'application/json' : p.endsWith('.svg') ? 'image/svg+xml' : p.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8';
createServer(async (req, res) => { try {
  const url = new URL(req.url, 'http://localhost'); const parts = url.pathname.split('/').filter(Boolean);
  if (url.pathname === '/healthz' && req.method === 'GET') return send(res, storageError ? 503 : 200, { status: storageError ? 'unavailable' : 'ok', revision: buildRevision });
  if (storageError && url.pathname.startsWith('/api/')) return send(res, 503, { error: 'unavailable' });
  if (url.pathname === '/api/groups' && req.method === 'POST') { const b = await readJson(req); if (b.name !== undefined && !validName(b.name)) return send(res, 400, { error: 'invalid_group' }); const token = randomBytes(32).toString('base64url'); const now = new Date().toISOString(); await transact(next => { next.groups[tokenHash(token)] = { id: randomUUID(), name: b.name?.trim() || '', createdAt: now, players: {}, matches: {} }; }); return send(res, 201, { token, group: { name: b.name?.trim() || '', createdAt: now } }); }
  if (parts[0] === 'api' && parts[1] === 'groups' && parts[2]) { const g = group(parts[2]); if (!g) return send(res, 404, { error: 'not_found' }); if (parts.length === 3 && req.method === 'GET') return send(res, 200, { group: { name: g.name, createdAt: g.createdAt }, players: Object.values(g.players), matches: Object.values(g.matches) });
    if (parts[3] === 'players' && parts.length === 4 && req.method === 'GET') return send(res, 200, { players: Object.values(g.players) });
    if (parts[3] === 'players' && parts.length === 4 && req.method === 'POST') { const b = await readJson(req); if (!validName(b.name)) return send(res, 400, { error: 'invalid_player' }); const p = { id: randomUUID(), name: b.name.trim(), createdAt: new Date().toISOString() }; await transact(next => { next.groups[tokenHash(parts[2])].players[p.id] = p; }); return send(res, 201, { player: p }); }
    if (parts[3] === 'players' && parts[4] && parts.length === 5 && req.method === 'PATCH') { const b = await readJson(req); if (!validName(b.name)) return send(res, 400, { error: 'invalid_player' }); const updated = await transact(next => { const target = next.groups[tokenHash(parts[2])]; const current = target.players[parts[4]]; if (!current) return { commit: false, value: undefined }; const player = { ...current, name: b.name.trim() }; target.players[parts[4]] = player; return { value: player }; }); return updated ? send(res, 200, { player: updated }) : send(res, 404, { error: 'not_found' }); }
    if (parts[3] === 'players' && parts[4] && parts[5] === 'statistics-reset' && req.method === 'POST') { const updated = await transact(next => { const target = next.groups[tokenHash(parts[2])]; const current = target.players[parts[4]]; if (!current) return { commit: false, value: undefined }; const player = { ...current, statsResetAt: new Date().toISOString() }; target.players[parts[4]] = player; return { value: player }; }); return updated ? send(res, 200, { player: updated }) : send(res, 404, { error: 'not_found' }); }
    if (parts[3] === 'players' && parts[4] && parts.length === 5 && req.method === 'DELETE') { await transact(next => { const target = next.groups[tokenHash(parts[2])]; if (!target.players[parts[4]]) return { commit: false }; delete target.players[parts[4]]; }); return send(res, 200, { deleted: true }); }
    if (parts[3] === 'matches' && parts.length === 4 && req.method === 'GET') return send(res, 200, { matches: Object.values(g.matches) });
    if (parts[3] === 'matches' && parts[4] && req.method === 'PUT') { const b = await readJson(req); if (!validMatch(b) || b.id !== parts[4]) return send(res, 400, { error: 'invalid_match' }); const serialized = JSON.stringify(b); const status = await transact(next => { const target = next.groups[tokenHash(parts[2])]; const old = target.matches[b.id]; if (old && JSON.stringify(old) !== serialized) return { commit: false, value: 409 }; target.matches[b.id] = b; return { value: old ? 200 : 201 }; }); if (status === 409) return send(res, 409, { error: 'match_conflict' }); return send(res, status, { match: b }); }
    if (parts[3] === 'matches' && parts[4] && req.method === 'DELETE') { await transact(next => { const target = next.groups[tokenHash(parts[2])]; if (!target.matches[parts[4]]) return { commit: false }; delete target.matches[parts[4]]; }); return send(res, 200, { deleted: true }); }
  }
  if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not_found' });
  let path;
  try { path = decodeURIComponent(url.pathname); } catch { return send(res, 400, { error: 'bad_path' }); }
  const target = resolve(dist, `.${path === '/' ? '/index.html' : path}`);
  if (target !== dist && !target.startsWith(`${dist}${sep}`)) return send(res, 404, { error: 'not_found' });
  const cacheControl = target.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
  try { const file = await readFile(target); res.writeHead(200, { 'content-type': mime(target), 'cache-control': cacheControl }); res.end(file); }
  catch { if (extname(path)) return send(res, 404, { error: 'not_found' }); const html = await readFile(join(dist, 'index.html')); res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' }); res.end(html); }
} catch (e) { if (e.message === 'storage_unavailable') return send(res, 503, { error: 'unavailable' }); send(res, e.message === 'too_large' ? 413 : 400, { error: 'bad_request' }); } }).listen(Number(process.env.PORT || 4173), '0.0.0.0', () => console.log(`Dart Scorekeeper: http://0.0.0.0:${process.env.PORT || 4173}`));
