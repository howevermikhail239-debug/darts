import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('production artifact activates updates immediately and identifies its build', async () => {
  const [worker, upgradeBridge, version, index] = await Promise.all([
    readFile('dist/sw.js', 'utf8'),
    readFile('dist/sw-update.js', 'utf8'),
    readFile('dist/version.json', 'utf8').then(JSON.parse),
    readFile('dist/index.html', 'utf8'),
  ]);
  assert.match(worker, /skipWaiting\(\)/);
  assert.match(worker, /clientsClaim\(\)/);
  assert.match(worker, /cleanupOutdatedCaches\(\)/);
  assert.match(worker, /precacheAndRoute\(/);
  assert.match(worker, /importScripts\("\/sw-update\.js"\)/);
  assert.match(upgradeBridge, /registration\.active/);
  assert.match(upgradeBridge, /client\.navigate\(client\.url\)/);
  assert.equal(typeof version.revision, 'string');
  assert.ok(version.revision.length > 0);
  assert.match(index, /\/assets\/index-[A-Za-z0-9_-]+\.js/);
});
