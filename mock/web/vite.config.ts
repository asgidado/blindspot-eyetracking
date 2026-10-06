import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  publicDir: fileURLToPath(new URL('../../vendor/models', import.meta.url)),
  resolve: { alias: { '@gaze': fileURLToPath(new URL('../../packages/gaze-web/src', import.meta.url)) } },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8000', '/vendor': 'http://localhost:8000' },
    fs: { allow: ['../..'] },
  },
  optimizeDeps: { include: ['webeyetrack', 'webgazer', '@mediapipe/tasks-vision'] },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 4000 },
});
