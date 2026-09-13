import { defineConfig } from '@playwright/test';

// 本地默认连 vite preview（见 e2e/README）；
// docker compose 的 verify 服务通过 PLAYWRIGHT_BASE_URL 指向真实 nginx 容器。
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:4173';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL,
    headless: true,
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npm run preview -- --port 4173',
        port: 4173,
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
