// Copies the data folder (DATA_DIR, default ../data) into public/ so the static export ships it verbatim
// (latest/, previous/, img/, *_ko.json, CNAME), then adds the legacy .html redirect stubs.
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(web, process.env.DATA_DIR ?? "../data");
const pub = join(web, "public");
if (!existsSync(src)) throw new Error(`DATA_DIR not found: ${src}`);
rmSync(pub, { recursive: true, force: true });
cpSync(src, pub, { recursive: true, filter: (p) => !/[/\\]\./.test(p.slice(src.length)) });
cpSync(join(web, "legacy-redirects"), pub, { recursive: true });
console.log(`synced ${src} -> public/`);
