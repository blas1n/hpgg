import { defineConfig } from "@playwright/test";

// `npm run e2e` builds the static export against web/tests/e2e-data into dist-e2e, then serves it like GitHub Pages.
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  use: { baseURL: "http://localhost:4173/hots/", viewport: { width: 390, height: 844 } },
  webServer: {
    command: "node scripts/serve.mjs dist-e2e 4173",
    url: "http://localhost:4173/hots/",
    reuseExistingServer: false,
    timeout: 60_000,
  },
  reporter: "list",
});
