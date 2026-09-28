import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

// Static export served by GitHub Pages at https://hpgg.win/ (custom domain). Each game lives under its own
// folder (/hots/). data/ is copied into public/ by scripts/sync-data.mjs; DATA_DIR / NEXT_DIST_DIR let the
// e2e suite build against the frozen fixture data set into a separate folder. The dev server keeps .next so a
// running `npm run dev` and a build never write into the same folder.
export default function config(phase: string): NextConfig {
  return {
    output: "export",
    trailingSlash: true,
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next" : (process.env.NEXT_DIST_DIR ?? "dist"),
    images: { unoptimized: true },
    reactStrictMode: true,
  };
}
