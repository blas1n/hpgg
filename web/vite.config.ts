import { defineConfig } from "vite";

// GitHub Pages serves the project at /hotsmeta/ until a custom domain is attached.
// data/ (latest/, previous/, heroes_ko.json, maps_ko.json) is published verbatim next to the page.
// VITE_DATA_DIR / VITE_OUT_DIR let the e2e suite build against a frozen fixture data set.
export default defineConfig({
  base: process.env.VITE_BASE ?? "/hotsmeta/",
  publicDir: process.env.VITE_DATA_DIR ?? "../data",
  build: { outDir: process.env.VITE_OUT_DIR ?? "dist", emptyOutDir: true },
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: { include: ["src/formula.ts", "src/wilson.ts"], thresholds: { lines: 80 } },
  },
});
