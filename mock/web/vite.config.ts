import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@gaze': fileURLToPath(new URL('../../packages/gaze-web/src', import.meta.url)) } },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8000', '/vendor': 'http://localhost:8000' },
    fs: { allow: ['../..'] },
  },
  optimizeDeps: { exclude: ['webgazer', 'webeyetrack'] },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 4000 },
});
