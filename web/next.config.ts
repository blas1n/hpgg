import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

// Static export served by GitHub Pages at https://hpgg.win/ (custom domain). Each game lives under its own
// folder (/hots/). data/ is copied into public/ by scripts/sync-data.mjs; DATA_DIR / NEXT_DIST_DIR let the
// e2e suite build against the frozen fixture data set into a separate folder. `next build` still writes its
// internals to .next (only the export goes to distDir), so the dev server gets its own .next-dev: a build while
// `npm run dev` is running must not overwrite the dev server's chunks ("Cannot find module './611.js'").
export default function config(phase: string): NextConfig {
  return {
    output: "export",
    trailingSlash: true,
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : (process.env.NEXT_DIST_DIR ?? "dist"),
    images: { unoptimized: true },
    reactStrictMode: true,
    // two root layouts, one per language (app/(ko), app/(en)): the 404 page brings its own document (#10)
    experimental: { globalNotFound: true },
    // Dev server reached from a phone over Tailscale (MagicDNS names, or IPs listed in DEV_ORIGINS in
    // web/.env.local). Next 16 refuses cross-origin dev resources and the HMR socket otherwise.
    allowedDevOrigins: ["*.ts.net", ...(process.env.DEV_ORIGINS?.split(",").filter(Boolean) ?? [])],
  };
}
