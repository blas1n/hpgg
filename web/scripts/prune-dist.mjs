// `npm run build`, after next build: drop switched-off features from the export (scripts/prune-features.ts).
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pruneDisabled } from "./prune-features.ts";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(web, process.env.NEXT_DIST_DIR ?? "dist");
const removed = pruneDisabled(dist);
console.log(`switched-off features: ${removed.length ? `removed ${removed.join(", ")}` : "none"}`);
