import type { NextConfig } from "next";

// Static export served by GitHub Pages at https://hpgg.win/ (custom domain). Each game lives under its own
// folder (/hots/). data/ is copied into public/ by scripts/sync-data.mjs; DATA_DIR / NEXT_DIST_DIR let the
// e2e suite build against the frozen fixture data set into a separate folder.
const config: NextConfig = {
  output: "export",
  trailingSlash: true,
  distDir: process.env.NEXT_DIST_DIR ?? "dist",
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default config;
