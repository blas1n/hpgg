import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  use: { baseURL: "http://localhost:4173/hotsmeta/", viewport: { width: 390, height: 844 } },
  webServer: {
    command: "VITE_OUT_DIR=dist-e2e npx vite preview --port 4173 --strictPort",
    url: "http://localhost:4173/hotsmeta/",
    reuseExistingServer: false,
    timeout: 60_000,
  },
  reporter: "list",
});
