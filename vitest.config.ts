import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/protocol/**/*.ts"],
      exclude: ["src/protocol/**/*.test.ts"],
      reporter: ["text", "json-summary", "html"],
      thresholds: {
        "src/protocol/crc16.ts": { branches: 100 },
        "src/protocol/packets.ts": { branches: 100 },
      },
    },
  },
});
