import { defineConfig } from "@playwright/test";

// `npm run e2e` builds the static export against web/tests/e2e-data into dist-e2e, then serves it like GitHub Pages.
// E2E_PORT: run several checkouts' suites side by side (default 4173).
const port = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${port}/ko/hots/`,
    viewport: { width: 390, height: 844 },
    // the shutdown notice (src/lib/shutdown.ts) covers every page: specs start with it hidden; e2e/shutdown.spec.ts opts out
    storageState: { cookies: [], origins: [{ origin: `http://localhost:${port}`, localStorage: [{ name: "hpgg-shutdown-notice-hidden", value: "9999-12-31" }] }] },
  },
  webServer: {
    command: `node scripts/serve.mjs dist-e2e ${port}`,
    url: `http://localhost:${port}/ko/hots/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  reporter: "list",
});
