import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: 'prompt',
    includeAssets: ['icon-192.png', 'icon-512.png', 'icon-192.svg'],
    manifest: {
      name: 'Счётчик дартса', short_name: 'Дартс', description: 'Локальный счёт и статистика дартса',
      theme_color: '#11161b', background_color: '#11161b', display: 'standalone', lang: 'ru',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
      ]
    },
    workbox: { cleanupOutdatedCaches: true, navigateFallback: '/index.html', navigateFallbackDenylist: [/^\/api\//] }
  })],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['./tests/**/*.test.{ts,tsx}'],
  },
  preview: {
    allowedHosts: ['localhost', '127.0.0.1', '[::1]'],
  },
});
