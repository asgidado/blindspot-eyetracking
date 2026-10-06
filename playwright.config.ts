import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  retries: 0,
  use: { baseURL: 'http://127.0.0.1:5173', viewport: { width: 1400, height: 900 }, trace: 'retain-on-failure' },
  webServer: [
    { command: 'uv run uvicorn mock.api.main:app --port 8000', port: 8000, reuseExistingServer: true, timeout: 60_000 },
    { command: 'npm run dev -w mock/web -- --host 127.0.0.1 --port 5173', port: 5173, reuseExistingServer: true, timeout: 60_000 },
  ],
});
