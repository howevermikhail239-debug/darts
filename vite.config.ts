import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const nodeProcess = (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } })
  .process;
const buildRevision = nodeProcess?.env?.BUILD_REVISION ?? 'unknown';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'build-revision',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ revision: buildRevision }) });
      },
    },
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon-192.png', 'icon-512.png', 'icon-192.svg'],
      manifest: {
        name: 'Счётчик дартса',
        short_name: 'Дартс',
        description: 'Локальный счёт и статистика дартса',
        theme_color: '#11161b',
        background_color: '#11161b',
        display: 'standalone',
        lang: 'ru',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        skipWaiting: false,
        clientsClaim: false,
        importScripts: ['/sw-update.js'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  define: { __BUILD_REVISION__: JSON.stringify(buildRevision) },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['./tests/**/*.test.{ts,tsx}'],
  },
  preview: {
    allowedHosts: ['localhost', '127.0.0.1', '[::1]'],
  },
});
