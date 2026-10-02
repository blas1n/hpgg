import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // tsconfig's "@/*" → src/*, so tests can import modules that use it (src/routes/root.tsx)
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: { include: ["src/formula.ts", "src/wilson.ts", "src/lib/**/*.ts", "src/i18n/**/*.ts"], thresholds: { lines: 80 } },
  },
});
