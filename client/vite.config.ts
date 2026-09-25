import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@shared': path.resolve(__dirname, '../shared') },
  },
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    proxy: {
      // SSE works through this proxy; the server disables buffering on /api/risk/stream.
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      // Private-preview access page (SITE_PASSWORD), served by the API server.
      '/__access': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
