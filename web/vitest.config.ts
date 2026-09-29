import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: { include: ["src/formula.ts", "src/wilson.ts", "src/lib/**/*.ts", "src/i18n/**/*.ts"], thresholds: { lines: 80 } },
  },
});
