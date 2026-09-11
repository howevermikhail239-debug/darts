/* global clients, self */
let replacesExistingWorker = false;

self.addEventListener('install', () => {
  replacesExistingWorker = Boolean(self.registration.active);
});

self.addEventListener('activate', (event) => {
  if (!replacesExistingWorker) return;
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((windows) => Promise.all(
      windows.map((client) => client.navigate(client.url)),
    )),
  );
});
