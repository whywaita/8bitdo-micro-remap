import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  timeout: 10000,
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://127.0.0.1:4173/8bitdo-micro-remap/",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "pnpm exec vite build --mode e2e && pnpm exec vite preview --port 4173 --strictPort",
    url: "http://127.0.0.1:4173/8bitdo-micro-remap/",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
