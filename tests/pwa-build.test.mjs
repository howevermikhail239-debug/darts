import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/**
 * REL-3. Раньше здесь был грep по собранному `dist/`, который проверял, что код
 * написан, а не что он работает. Теперь мы исполняем `public/sw-update.js` в
 * смоделированном окружении service worker и проверяем поведение:
 * обновление применяется только по запросу страницы и никогда не перезагружает
 * открытые окна само.
 */
async function loadUpdateBridge() {
  const source = await readFile('public/sw-update.js', 'utf8');
  const listeners = new Map();
  const navigations = [];
  const worker = {
    skipWaitingCalls: 0,
    registration: { active: { state: 'activated' } },
    addEventListener(type, handler) {
      listeners.set(type, [...(listeners.get(type) ?? []), handler]);
    },
    skipWaiting() { worker.skipWaitingCalls += 1; },
  };
  const openWindow = {
    url: 'https://darts.example/g/token',
    navigate(url) { navigations.push(url); return Promise.resolve(openWindow); },
  };
  const clients = {
    matchAll: () => Promise.resolve([openWindow]),
    claim: () => Promise.resolve(),
  };
  new Function('self', 'clients', source)(worker, clients);
  const dispatch = async (type, event = {}) => {
    const waits = [];
    const payload = { ...event, waitUntil: (promise) => waits.push(promise) };
    for (const handler of listeners.get(type) ?? []) await handler(payload);
    await Promise.all(waits);
  };
  return { worker, navigations, listeners, dispatch };
}

test('the update bridge never navigates open windows on its own', async () => {
  const { worker, navigations, dispatch } = await loadUpdateBridge();

  await dispatch('install');
  await dispatch('activate');

  assert.deepEqual(navigations, [], 'открытые окна не должны перезагружаться без согласия пользователя');
  assert.equal(worker.skipWaitingCalls, 0, 'новый worker не должен активироваться сам');
});

test('the update bridge applies a waiting update only when the page asks for it', async () => {
  const { worker, navigations, dispatch } = await loadUpdateBridge();

  await dispatch('message', { data: { type: 'PING' } });
  assert.equal(worker.skipWaitingCalls, 0);

  await dispatch('message', { data: { type: 'SKIP_WAITING' } });
  assert.equal(worker.skipWaitingCalls, 1, 'нажатие «Обновить» должно активировать ожидающий worker');
  assert.deepEqual(navigations, []);
});

test('the update bridge tolerates messages without a payload', async () => {
  const { worker, dispatch } = await loadUpdateBridge();

  await dispatch('message', { data: undefined });
  await dispatch('message', { data: 'SKIP_WAITING' });

  assert.equal(worker.skipWaitingCalls, 0);
});

test('the build is configured to wait for the user before activating a new version', async () => {
  const config = await readFile('vite.config.ts', 'utf8');

  assert.match(config, /registerType:\s*'prompt'/);
  assert.match(config, /skipWaiting:\s*false/);
  assert.match(config, /clientsClaim:\s*false/);
  assert.match(config, /importScripts:\s*\['\/sw-update\.js'\]/);
});
