#!/usr/bin/env node
/* Operator-only legacy owner bootstrap. Reads the invite token from stdin, never argv or logs. */
import { createHash, randomBytes } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

const argument = process.argv.slice(2);
const dataIndex = argument.indexOf('--data');
const file = resolve(
  dataIndex >= 0 ? argument[dataIndex + 1] : (process.env.DARTS_DATA_FILE ?? 'data/dart-scorekeeper.json'),
);
if ((argument.length !== 0 && (argument.length !== 2 || dataIndex !== 0 || !argument[1])) || !file) {
  console.error(
    'Usage: printf %s "$INVITE_TOKEN" | node issue-company-owner-key.mjs --data /absolute/dart-scorekeeper.json',
  );
  process.exitCode = 2;
} else {
  const token = (
    await new Promise((resolveInput) => {
      let text = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => {
        text += chunk;
      });
      process.stdin.on('end', () => resolveInput(text.trim()));
    })
  ).trim();
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  if (!token) {
    console.error('Invite token was not provided on stdin.');
    process.exitCode = 2;
  } else {
    const store = JSON.parse(await readFile(file, 'utf8'));
    const group = store?.groups?.[hash(token)];
    if (!group) {
      console.error('Company was not found.');
      process.exitCode = 1;
    } else if (typeof group.ownerKeyHash === 'string') {
      console.error('This company already has an owner credential.');
      process.exitCode = 1;
    } else {
      const key = randomBytes(32).toString('base64url');
      group.ownerKeyHash = hash(key);
      group.identityClaims ??= {};
      const temporary = resolve(dirname(file), `.${basename(file)}.${process.pid}.tmp`);
      await writeFile(temporary, JSON.stringify(store), { mode: 0o600 });
      await rename(temporary, file);
      // The only plaintext secret output. Do not redirect this command to logs.
      process.stdout.write(`${key}\n`);
    }
  }
}
