/* global process, console, URL, Buffer, structuredClone, setTimeout, setInterval */
import { createServer } from 'node:http';
import { access, mkdir, readFile, readdir, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
const dataDir = process.env.DATA_DIR || join(root, 'data');
const dataFile = process.env.DARTS_DATA_FILE || join(dataDir, 'dart-scorekeeper.json');
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '0.0.0.0';

const number = (name, fallback) => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/** Request bodies are bounded in bytes, exactly as before. */
const MAX_BODY_BYTES = 512 * 1024;

/** Storage quotas keep the single-file store inside a workable size (PERF-1). */
const QUOTA = {
  matchBytes: number('DARTS_MAX_MATCH_BYTES', 256 * 1024),
  confirmedVisits: number('DARTS_MAX_CONFIRMED_VISITS', 5000),
  matchesPerGroup: number('DARTS_MAX_MATCHES_PER_GROUP', 5000),
  playersPerGroup: number('DARTS_MAX_PLAYERS_PER_GROUP', 200),
  groups: number('DARTS_MAX_GROUPS', 10000),
};

/** Rate limits default to production values; the environment only narrows them for tests. */
const RATE = {
  groupsPerWindow: number('DARTS_RATE_LIMIT_GROUPS', 5),
  groupWindowMs: number('DARTS_RATE_LIMIT_GROUP_WINDOW_MS', 60 * 60 * 1000),
  mutationsPerWindow: number('DARTS_RATE_LIMIT_MUTATIONS', 120),
  mutationWindowMs: number('DARTS_RATE_LIMIT_MUTATION_WINDOW_MS', 60 * 1000),
};

const STORAGE_PROBE_MS = number('DARTS_STORAGE_PROBE_MS', 30_000);
const LOG_LEVEL = ['silent', 'error', 'info'].includes(process.env.LOG_LEVEL || '')
  ? process.env.LOG_LEVEL
  : 'info';

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=31536000',
  'x-frame-options': 'DENY',
  'content-security-policy': [
    "default-src 'self'",
    "connect-src 'self'",
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
  ].join('; '),
};

const MIME_TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

const RESERVED_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
  'toString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
]);

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const tokenHash = token => createHash('sha256').update(token).digest('hex');

class RequestError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const EXPECTED_ERRORS = {
  too_large: { status: 413, body: 'too_large' },
  bad_json: { status: 400, body: 'bad_json' },
  storage_unavailable: { status: 503, body: 'unavailable' },
};

/** Canonical serialization: keys sorted at every level, so key order never means "changed". */
const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const fields = keys
      .filter(key => value[key] !== undefined)
      .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`);
    return `{${fields.join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
};

const logEvent = entry => {
  if (LOG_LEVEL !== 'info') return;
  console.error(JSON.stringify(entry));
};

const logError = (event, error) => {
  if (LOG_LEVEL === 'silent') return;
  console.error(`[${event}]`, error instanceof Error ? error.stack || error.message : error);
};

/** The company token never reaches the log: only the first 8 characters of its hash do. */
const normalizePath = pathname => {
  const parts = pathname.split('/');
  if (parts[1] === 'api' && parts[2] === 'groups' && parts[3]) {
    parts[3] = `t_${tokenHash(parts[3]).slice(0, 8)}`;
  }
  if (parts[4] === 'players' && parts[5]) parts[5] = ':playerId';
  if (parts[4] === 'matches' && parts[5]) parts[5] = ':matchId';
  return parts.join('/');
};

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

let buildRevision = 'unknown';
try {
  const version = JSON.parse(await readFile(join(dist, 'version.json'), 'utf8'));
  if (typeof version.revision === 'string') buildRevision = version.revision;
} catch {
  /* A missing identifier remains visible as unknown. */
}

let writing = Promise.resolve();
let data = { version: 1, groups: {} };
/** Writes are refused while true; reads keep working (REL-1). */
let storageError = false;
/** Set only for unreadable or corrupt storage, which must never be overwritten automatically. */
let storageFatal = false;

/** Matches are stored as { match, revision, updatedAt }; older files hold the bare match. */
const normalizeStored = parsed => {
  if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) {
    throw new Error('Invalid Dart Scorekeeper storage envelope');
  }
  if (!parsed.groups || typeof parsed.groups !== 'object' || Array.isArray(parsed.groups)) {
    throw new Error('Invalid Dart Scorekeeper storage envelope');
  }
  for (const group of Object.values(parsed.groups)) {
    if (!group || typeof group !== 'object') throw new Error('Invalid Dart Scorekeeper group');
    group.players = group.players && typeof group.players === 'object' ? group.players : {};
    group.matches = group.matches && typeof group.matches === 'object' ? group.matches : {};
    for (const [id, entry] of Object.entries(group.matches)) {
      if (entry && typeof entry === 'object' && entry.match && typeof entry.revision === 'number') continue;
      group.matches[id] = { match: entry, revision: 1, updatedAt: group.createdAt || null };
    }
  }
  return parsed;
};

const removeTemporaryFiles = async () => {
  const directory = dirname(dataFile);
  const prefix = `${basename(dataFile)}.`;
  try {
    for (const name of await readdir(directory)) {
      if (!name.startsWith(prefix) || !name.endsWith('.tmp')) continue;
      await unlink(join(directory, name)).catch(() => {});
    }
  } catch {
    /* An unreadable directory is reported by the storage probe instead. */
  }
};

try {
  await mkdir(dirname(dataFile), { recursive: true });
  await access(dirname(dataFile), constants.R_OK | constants.W_OK);
} catch {
  storageError = true;
}

if (!storageError) {
  await removeTemporaryFiles();
  try {
    data = normalizeStored(JSON.parse(await readFile(dataFile, 'utf8')));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      storageError = true;
      storageFatal = true;
      logError('storage_unreadable', error);
    }
  }
}

const persist = async next => {
  await mkdir(dirname(dataFile), { recursive: true });
  const temporary = `${dataFile}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(next), 'utf8');
  await rename(temporary, dataFile);
};

/**
 * Serializes every mutation. Only the affected group is cloned; the rest of the
 * database is shared by reference, so the cost no longer scales with total size.
 */
const transact = (groupHash, mutate) => {
  const operation = writing.then(async () => {
    if (storageError) throw new RequestError('storage_unavailable', 503);
    const next = { ...data, groups: { ...data.groups } };
    if (groupHash && own(data.groups, groupHash)) {
      next.groups[groupHash] = structuredClone(data.groups[groupHash]);
    }
    const result = mutate(next);
    if (result?.commit === false) return result.value;
    try {
      await persist(next);
    } catch (error) {
      storageError = true;
      logError('storage_write_failed', error);
      throw new RequestError('storage_unavailable', 503);
    }
    data = next;
    storageError = false;
    return result?.value;
  });
  writing = operation.catch(() => {});
  return operation;
};

/** Periodically re-tests the data directory so a transient failure heals itself (REL-1). */
const probeStorage = async () => {
  if (!storageError || storageFatal) return;
  const probeFile = `${dataFile}.${process.pid}.probe.tmp`;
  try {
    await mkdir(dirname(dataFile), { recursive: true });
    await writeFile(probeFile, 'probe', 'utf8');
    await unlink(probeFile);
    storageError = false;
    logEvent({ event: 'storage_recovered', at: new Date().toISOString() });
  } catch {
    /* Still unavailable: the next tick tries again. */
  }
};

setInterval(() => {
  writing = writing.then(probeStorage, probeStorage);
}, STORAGE_PROBE_MS).unref();

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

const send = (res, code, body) => {
  if (res.writableEnded) return;
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    ...SECURITY_HEADERS,
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
};

const readJson = async (req, res, context) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    context.bytes = size;
    if (size > MAX_BODY_BYTES) {
      // Drain the remainder and close the connection, otherwise keep-alive is poisoned (REL-4).
      req.resume();
      if (!res.headersSent) res.setHeader('connection', 'close');
      throw new RequestError('too_large', 413);
    }
    chunks.push(chunk);
  }
  // A single decode at the end: a multi-byte character split across chunks stays intact (DATA-1).
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw new RequestError('bad_json', 400);
  }
};

const clientIp = req => {
  const forwarded = req.headers['x-forwarded-for'];
  const list = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const first = typeof list === 'string' ? list.split(',')[0].trim() : '';
  return first || req.socket.remoteAddress || 'unknown';
};

const rateBuckets = new Map();

/** Returns the number of seconds to wait when the limit is exceeded, otherwise null. */
const rateLimit = (key, limit, windowMs) => {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }
  bucket.count += 1;
  if (bucket.count <= limit) return null;
  return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
};

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) if (bucket.resetAt <= now) rateBuckets.delete(key);
}, 60_000).unref();

const tooManyRequests = (res, retryAfter) => {
  res.setHeader('retry-after', String(retryAfter));
  send(res, 429, { error: 'rate_limited', retryAfter });
};

const hasJsonContentType = req => {
  const value = req.headers['content-type'];
  if (typeof value !== 'string') return false;
  return value.split(';')[0].trim().toLowerCase() === 'application/json';
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const record = value => typeof value === 'object' && value !== null && !Array.isArray(value);
const validName = value =>
  typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 80;
const validId = value =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 160;

/**
 * Structural validation of a shared match. Game rules stay on the client by design,
 * but a payload that contradicts itself is refused here (SEC-4).
 */
const validMatch = value => {
  if (!record(value)) return 'invalid_match';
  if (!validId(value.id)) return 'invalid_match';
  if (!['completed', 'abandoned'].includes(value.status)) return 'invalid_match';
  if (typeof value.completedAt !== 'string' || value.completedAt.trim().length === 0) {
    return 'invalid_match';
  }
  if (typeof value.createdAt !== 'string' || value.createdAt.trim().length === 0) {
    return 'invalid_match';
  }
  const players = value.players;
  if (!Array.isArray(players) || players.length < 2 || players.length > 8) return 'invalid_match';
  if (!players.every(validId)) return 'invalid_match';
  if (new Set(players).size !== players.length) return 'invalid_match';
  if (!record(value.participantNames)) return 'invalid_match';
  const names = value.participantNames;
  const named = players.every(
    id => own(names, id) && typeof names[id] === 'string' && names[id].trim().length > 0,
  );
  if (!named) return 'invalid_match';
  if (value.winnerId !== undefined && !players.includes(value.winnerId)) return 'invalid_match';
  if (!record(value.state) || !['x01', 'fixed_visits'].includes(value.state.kind)) {
    return 'invalid_match';
  }
  if (!Array.isArray(value.confirmedVisits)) return 'invalid_match';
  if (value.confirmedVisits.length > QUOTA.confirmedVisits) return 'too_many_visits';
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > QUOTA.matchBytes) return 'match_too_large';
  return null;
};

const parseIfMatch = req => {
  const header = req.headers['if-match'];
  if (typeof header !== 'string') return undefined;
  const value = header.trim().replace(/^W\//i, '').replace(/^"(.*)"$/, '$1').trim();
  return value.length > 0 ? value : undefined;
};

// ---------------------------------------------------------------------------
// API handlers
// ---------------------------------------------------------------------------

const groupOf = token => {
  const hash = tokenHash(token);
  return own(data.groups, hash) ? data.groups[hash] : undefined;
};

const matchesOf = group => Object.values(group.matches).map(entry => entry.match);

const createGroup = async (req, res, context) => {
  const body = await readJson(req, res, context);
  if (body.name !== undefined && !validName(body.name)) {
    return send(res, 400, { error: 'invalid_group' });
  }
  const retryAfter = rateLimit(`groups:${clientIp(req)}`, RATE.groupsPerWindow, RATE.groupWindowMs);
  if (retryAfter !== null) return tooManyRequests(res, retryAfter);
  const token = randomBytes(32).toString('base64url');
  const name = body.name?.trim() || '';
  const createdAt = new Date().toISOString();
  const outcome = await transact(null, next => {
    if (Object.keys(next.groups).length >= QUOTA.groups) {
      return { commit: false, value: 'too_many_groups' };
    }
    next.groups[tokenHash(token)] = { id: randomUUID(), name, createdAt, players: {}, matches: {} };
    return { value: 'created' };
  });
  if (outcome === 'too_many_groups') return send(res, 409, { error: 'too_many_groups' });
  return send(res, 201, { token, group: { name, createdAt } });
};

const createPlayer = async (req, res, context, token) => {
  const body = await readJson(req, res, context);
  if (!validName(body.name)) return send(res, 400, { error: 'invalid_player' });
  const player = { id: randomUUID(), name: body.name.trim(), createdAt: new Date().toISOString() };
  const outcome = await transact(tokenHash(token), next => {
    const target = next.groups[tokenHash(token)];
    if (Object.keys(target.players).length >= QUOTA.playersPerGroup) {
      return { commit: false, value: 'too_many_players' };
    }
    target.players[player.id] = player;
    return { value: 'created' };
  });
  if (outcome === 'too_many_players') return send(res, 409, { error: 'too_many_players' });
  return send(res, 201, { player });
};

const updatePlayer = async (res, token, playerId, change) => {
  if (!UUID_V4.test(playerId)) return send(res, 404, { error: 'not_found' });
  const updated = await transact(tokenHash(token), next => {
    const target = next.groups[tokenHash(token)];
    if (!own(target.players, playerId)) return { commit: false, value: undefined };
    const player = { ...target.players[playerId], ...change() };
    target.players[playerId] = player;
    return { value: player };
  });
  return updated ? send(res, 200, { player: updated }) : send(res, 404, { error: 'not_found' });
};

const deletePlayer = async (res, token, playerId) => {
  if (!UUID_V4.test(playerId)) return send(res, 404, { error: 'not_found' });
  await transact(tokenHash(token), next => {
    const target = next.groups[tokenHash(token)];
    if (!own(target.players, playerId)) return { commit: false };
    delete target.players[playerId];
    return undefined;
  });
  return send(res, 200, { deleted: true });
};

const putMatch = async (req, res, context, token, matchId) => {
  if (RESERVED_KEYS.has(matchId)) return send(res, 404, { error: 'not_found' });
  const body = await readJson(req, res, context);
  const problem = validMatch(body);
  if (problem === 'match_too_large' || problem === 'too_many_visits') {
    return send(res, 413, { error: problem });
  }
  if (problem || body.id !== matchId) return send(res, 400, { error: 'invalid_match' });
  const updatedAt = new Date().toISOString();
  const expected = parseIfMatch(req);
  const payload = canonical(body);
  const outcome = await transact(tokenHash(token), next => {
    const target = next.groups[tokenHash(token)];
    const current = own(target.matches, matchId) ? target.matches[matchId] : undefined;
    if (!current) {
      if (Object.keys(target.matches).length >= QUOTA.matchesPerGroup) {
        return { commit: false, value: { status: 'too_many_matches' } };
      }
      target.matches[matchId] = { match: body, revision: 1, updatedAt };
      return { value: { status: 201, revision: 1 } };
    }
    if (expected !== undefined && expected !== '*' && String(current.revision) !== expected) {
      return {
        commit: false,
        value: { status: 409, revision: current.revision, match: current.match },
      };
    }
    if (canonical(current.match) === payload) {
      // Identical content: idempotent, no write, and never a false conflict (DATA-2).
      return { commit: false, value: { status: 200, revision: current.revision } };
    }
    const revision = current.revision + 1;
    target.matches[matchId] = { match: body, revision, updatedAt };
    return { value: { status: 200, revision } };
  });
  if (outcome.status === 'too_many_matches') return send(res, 409, { error: 'too_many_matches' });
  if (outcome.status === 409) {
    return send(res, 409, {
      error: 'match_conflict',
      revision: outcome.revision,
      match: outcome.match,
    });
  }
  return send(res, outcome.status, { match: body, revision: outcome.revision });
};

const deleteMatch = async (res, token, matchId) => {
  if (RESERVED_KEYS.has(matchId)) return send(res, 404, { error: 'not_found' });
  await transact(tokenHash(token), next => {
    const target = next.groups[tokenHash(token)];
    if (!own(target.matches, matchId)) return { commit: false };
    delete target.matches[matchId];
    return undefined;
  });
  return send(res, 200, { deleted: true });
};

const handleGroupRoutes = async (req, res, context, parts) => {
  const token = parts[2];
  const group = groupOf(token);
  if (!group) return send(res, 404, { error: 'not_found' });
  const method = req.method;

  if (parts.length === 3 && method === 'GET') {
    return send(res, 200, {
      group: { name: group.name, createdAt: group.createdAt },
      players: Object.values(group.players),
      matches: matchesOf(group),
    });
  }
  if (parts[3] === 'players' && parts.length === 4 && method === 'GET') {
    return send(res, 200, { players: Object.values(group.players) });
  }
  if (parts[3] === 'players' && parts.length === 4 && method === 'POST') {
    return createPlayer(req, res, context, token);
  }
  if (parts[3] === 'players' && parts[4] && parts.length === 5 && method === 'PATCH') {
    const body = await readJson(req, res, context);
    if (!validName(body.name)) return send(res, 400, { error: 'invalid_player' });
    return updatePlayer(res, token, parts[4], () => ({ name: body.name.trim() }));
  }
  if (parts[3] === 'players' && parts[4] && parts[5] === 'statistics-reset' && method === 'POST') {
    return updatePlayer(res, token, parts[4], () => ({ statsResetAt: new Date().toISOString() }));
  }
  if (parts[3] === 'players' && parts[4] && parts.length === 5 && method === 'DELETE') {
    return deletePlayer(res, token, parts[4]);
  }
  if (parts[3] === 'matches' && parts.length === 4 && method === 'GET') {
    return send(res, 200, { matches: matchesOf(group) });
  }
  if (parts[3] === 'matches' && parts[4] && parts.length === 5 && method === 'PUT') {
    return putMatch(req, res, context, token, parts[4]);
  }
  if (parts[3] === 'matches' && parts[4] && parts.length === 5 && method === 'DELETE') {
    return deleteMatch(res, token, parts[4]);
  }
  return send(res, 404, { error: 'not_found' });
};

// ---------------------------------------------------------------------------
// Static files
// ---------------------------------------------------------------------------

let distReal = dist;
try {
  distReal = await realpath(dist);
} catch {
  /* A missing dist directory keeps the API usable and yields 404 for static paths. */
}

const mime = path => MIME_TYPES[extname(path).toLowerCase()] || 'application/octet-stream';

const insideDist = path => path === distReal || path.startsWith(`${distReal}${sep}`);

const sendIndex = async res => {
  const html = await readFile(join(dist, 'index.html'));
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-cache',
  });
  res.end(html);
};

const serveStatic = async (res, pathname) => {
  let path;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return send(res, 400, { error: 'bad_path' });
  }
  const target = resolve(dist, `.${path === '/' ? '/index.html' : path}`);
  if (target !== dist && !target.startsWith(`${dist}${sep}`)) {
    return send(res, 404, { error: 'not_found' });
  }
  let file;
  try {
    // The real path closes the symlink escape that a lexical check cannot see (SEC-6).
    const actual = await realpath(target);
    if (!insideDist(actual)) return send(res, 404, { error: 'not_found' });
    file = await readFile(actual);
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR' && error.code !== 'EISDIR') throw error;
    if (extname(path)) return send(res, 404, { error: 'not_found' });
    return sendIndex(res);
  }
  const cacheControl = target.includes(`${sep}assets${sep}`)
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'content-type': mime(target),
    'cache-control': cacheControl,
  });
  res.end(file);
};

// ---------------------------------------------------------------------------
// Request pipeline
// ---------------------------------------------------------------------------

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

const route = async (req, res, context) => {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  context.path = normalizePath(url.pathname);

  if (url.pathname === '/healthz' && req.method === 'GET') {
    return send(res, storageError ? 503 : 200, {
      status: storageError ? 'unavailable' : 'ok',
      revision: buildRevision,
    });
  }

  const isApi = url.pathname === '/api' || url.pathname.startsWith('/api/');
  if (isApi) {
    if (BODY_METHODS.has(req.method) && !hasJsonContentType(req)) {
      req.resume();
      return send(res, 415, { error: 'unsupported_media_type' });
    }
    // Degraded storage stays readable: only writes are refused (REL-1).
    if (storageError && MUTATING_METHODS.has(req.method)) {
      req.resume();
      return send(res, 503, { error: 'unavailable' });
    }
    if (parts[1] === 'groups' && parts[2] && MUTATING_METHODS.has(req.method)) {
      const key = `mutations:${tokenHash(parts[2])}`;
      const retryAfter = rateLimit(key, RATE.mutationsPerWindow, RATE.mutationWindowMs);
      if (retryAfter !== null) {
        req.resume();
        return tooManyRequests(res, retryAfter);
      }
    }
    if (url.pathname === '/api/groups' && req.method === 'POST') {
      return createGroup(req, res, context);
    }
    if (parts[1] === 'groups' && parts[2]) return handleGroupRoutes(req, res, context, parts);
    return send(res, 404, { error: 'not_found' });
  }

  return serveStatic(res, url.pathname);
};

const failed = (res, error) => {
  if (res.headersSent || res.writableEnded) {
    res.destroy();
    return;
  }
  const expected = EXPECTED_ERRORS[error?.message];
  if (expected) return send(res, expected.status, { error: expected.body });
  logError('request_failed', error);
  return send(res, 500, { error: 'internal' });
};

const server = createServer((req, res) => {
  const startedAt = process.hrtime.bigint();
  const context = { bytes: 0, path: req.url };
  res.on('close', () => {
    logEvent({
      at: new Date().toISOString(),
      method: req.method,
      path: context.path,
      status: res.statusCode,
      durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
      bytes: context.bytes,
      completed: res.writableFinished,
    });
  });
  route(req, res, context).catch(error => failed(res, error));
});

server.headersTimeout = 10_000;
server.requestTimeout = 20_000;
server.maxConnections = 512;
server.on('clientError', (error, socket) => socket.destroy());

process.on('unhandledRejection', reason => logError('unhandled_rejection', reason));
process.on('uncaughtException', error => logError('uncaught_exception', error));

let shuttingDown = false;
const shutdown = signal => {
  if (shuttingDown) return;
  shuttingDown = true;
  logEvent({ event: 'shutdown', signal, at: new Date().toISOString() });
  server.close(() => {
    writing.then(() => process.exit(0), () => process.exit(0));
  });
  server.closeIdleConnections?.();
  setTimeout(() => process.exit(1), 10_000).unref();
};
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => shutdown(signal));

server.listen(port, host, () => console.log(`Dart Scorekeeper: http://${host}:${port}`));
