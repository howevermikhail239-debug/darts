/* global process, console */
import { readFile } from 'node:fs/promises';

const storage = JSON.parse(await readFile(process.argv[2], 'utf8'));
if (storage?.version !== 1 || !storage.groups || typeof storage.groups !== 'object' || Array.isArray(storage.groups)) {
  throw new Error('Invalid Dart Scorekeeper storage envelope');
}

let players = 0;
let matches = 0;
for (const [storedTokenHash, group] of Object.entries(storage.groups)) {
  if (!/^[a-f0-9]{64}$/.test(storedTokenHash)) {
    throw new Error('Storage contains a non-hashed company key');
  }
  if (!group || typeof group !== 'object' || !group.players || !group.matches) {
    throw new Error('Invalid Dart Scorekeeper group');
  }
  players += Object.keys(group.players).length;
  matches += Object.keys(group.matches).length;
}

console.log(JSON.stringify({ valid: true, companies: Object.keys(storage.groups).length, players, matches }));
