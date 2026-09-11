/* global process, console */
import { readFile } from 'node:fs/promises';

const storage = JSON.parse(await readFile(process.argv[2], 'utf8'));
if (storage?.version !== 1 || !storage.groups || typeof storage.groups !== 'object' || Array.isArray(storage.groups)) {
  throw new Error('Invalid Dart Scorekeeper storage envelope');
}

const isRecord = value => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = value => typeof value === 'string' && value.trim().length > 0;

/** Matches are stored as { match, revision, updatedAt }; files written before that carry the bare match. */
const checkMatch = (entry, matchId) => {
  if (!isRecord(entry)) throw new Error(`Invalid stored match ${matchId}`);
  const versioned = isRecord(entry.match);
  const match = versioned ? entry.match : entry;
  if (versioned) {
    if (!Number.isSafeInteger(entry.revision) || entry.revision < 1) {
      throw new Error(`Invalid revision for match ${matchId}`);
    }
    if (entry.updatedAt !== null && entry.updatedAt !== undefined && !isText(entry.updatedAt)) {
      throw new Error(`Invalid updatedAt for match ${matchId}`);
    }
  }
  if (!isText(match.id) || match.id !== matchId) throw new Error(`Mismatched match identifier ${matchId}`);
  if (!Array.isArray(match.players) || match.players.length < 2) throw new Error(`Invalid players in match ${matchId}`);
  if (!isRecord(match.state)) throw new Error(`Invalid state in match ${matchId}`);
  return versioned;
};

let players = 0;
let matches = 0;
let versionedMatches = 0;
for (const [storedTokenHash, group] of Object.entries(storage.groups)) {
  if (!/^[a-f0-9]{64}$/.test(storedTokenHash)) {
    throw new Error('Storage contains a non-hashed company key');
  }
  if (!group || typeof group !== 'object' || !group.players || !group.matches) {
    throw new Error('Invalid Dart Scorekeeper group');
  }
  for (const [matchId, entry] of Object.entries(group.matches)) {
    if (checkMatch(entry, matchId)) versionedMatches += 1;
  }
  players += Object.keys(group.players).length;
  matches += Object.keys(group.matches).length;
}

console.log(JSON.stringify({
  valid: true,
  companies: Object.keys(storage.groups).length,
  players,
  matches,
  versionedMatches,
}));
