/* global process, URL, console */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, join, resolve, sep, extname } from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
const dataFile = process.env.DARTS_DATA_FILE || join(root, 'data', 'dart-scorekeeper.json');
let writing = Promise.resolve();
let data = { version: 1, groups: {} };
let storageError = false;
try { data = JSON.parse(await readFile(dataFile, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') storageError = true; }
const tokenHash = t => createHash('sha256').update(t).digest('hex');
const persist = () => writing = writing.then(async () => { if (storageError) throw new Error('storage_unavailable'); await mkdir(dirname(dataFile), { recursive: true }); const tmp = `${dataFile}.${process.pid}.tmp`; await writeFile(tmp, JSON.stringify(data), 'utf8'); await rename(tmp, dataFile); });
const send = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const readJson = async req => { let size = 0, body = ''; for await (const c of req) { size += c.length; if (size > 512 * 1024) throw new Error('too_large'); body += c; } try { return JSON.parse(body || '{}'); } catch { throw new Error('bad_json'); } };
const group = token => data.groups[tokenHash(token)];
const validName = x => typeof x === 'string' && x.trim().length > 0 && x.trim().length <= 80;
const validMatch = x => x && typeof x === 'object' && typeof x.id === 'string' && x.id.length > 0 && x.id.length <= 160 && ['completed','abandoned'].includes(x.status) && Array.isArray(x.players) && x.players.length >= 2 && x.players.length <= 8 && Array.isArray(x.confirmedVisits) && x.state && typeof x.state === 'object';
const mime = p => p.endsWith('.js') ? 'text/javascript' : p.endsWith('.css') ? 'text/css' : p.endsWith('.json') ? 'application/json' : p.endsWith('.svg') ? 'image/svg+xml' : p.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8';
createServer(async (req, res) => { try {
  const url = new URL(req.url, 'http://localhost'); const parts = url.pathname.split('/').filter(Boolean);
  if (storageError && url.pathname.startsWith('/api/')) return send(res, 503, { error: 'unavailable' });
  if (url.pathname === '/api/groups' && req.method === 'POST') { const b = await readJson(req); if (b.name !== undefined && !validName(b.name)) return send(res, 400, { error: 'invalid_group' }); const token = randomBytes(32).toString('base64url'); const now = new Date().toISOString(); data.groups[tokenHash(token)] = { id: randomUUID(), name: b.name?.trim() || '', createdAt: now, players: {}, matches: {} }; await persist(); return send(res, 201, { token, group: { name: b.name?.trim() || '', createdAt: now } }); }
  if (parts[0] === 'api' && parts[1] === 'groups' && parts[2]) { const g = group(parts[2]); if (!g) return send(res, 404, { error: 'not_found' }); if (parts.length === 3 && req.method === 'GET') return send(res, 200, { group: { name: g.name, createdAt: g.createdAt }, players: Object.values(g.players), matches: Object.values(g.matches) });
    if (parts[3] === 'players' && req.method === 'GET') return send(res, 200, { players: Object.values(g.players) });
    if (parts[3] === 'players' && req.method === 'POST') { const b = await readJson(req); if (!validName(b.name)) return send(res, 400, { error: 'invalid_player' }); const p = { id: randomUUID(), name: b.name.trim(), createdAt: new Date().toISOString() }; g.players[p.id] = p; await persist(); return send(res, 201, { player: p }); }
    if (parts[3] === 'matches' && req.method === 'GET') return send(res, 200, { matches: Object.values(g.matches) });
    if (parts[3] === 'matches' && parts[4] && req.method === 'PUT') { const b = await readJson(req); if (!validMatch(b) || b.id !== parts[4]) return send(res, 400, { error: 'invalid_match' }); const old = g.matches[b.id]; const serialized = JSON.stringify(b); if (old && JSON.stringify(old) !== serialized) return send(res, 409, { error: 'match_conflict' }); g.matches[b.id] = b; await persist(); return send(res, old ? 200 : 201, { match: b }); }
  }
  if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not_found' });
  let path;
  try { path = decodeURIComponent(url.pathname); } catch { return send(res, 400, { error: 'bad_path' }); }
  const target = resolve(dist, `.${path === '/' ? '/index.html' : path}`);
  if (target !== dist && !target.startsWith(`${dist}${sep}`)) return send(res, 404, { error: 'not_found' });
  try { const file = await readFile(target); res.writeHead(200, { 'content-type': mime(target) }); res.end(file); }
  catch { if (extname(path)) return send(res, 404, { error: 'not_found' }); const html = await readFile(join(dist, 'index.html')); res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); }
} catch (e) { send(res, e.message === 'too_large' ? 413 : 400, { error: 'bad_request' }); } }).listen(Number(process.env.PORT || 4173), '0.0.0.0', () => console.log(`Dart Scorekeeper: http://0.0.0.0:${process.env.PORT || 4173}`));
