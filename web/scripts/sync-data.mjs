// Copies the data folder (DATA_DIR, default ../data) into public/ so the static export ships it verbatim
// (latest/, previous/, img/, *_ko.json, CNAME), then writes robots.txt + sitemap.xml (scripts/sitemap.ts) and the forwarding pages for the URLs that were live before
// every language moved under /<locale>/ (scripts/forwarders.ts: /, /hots/…, every hero and map, hots/*.html).
// Run with Node's type stripping (package.json scripts) so it can load the TypeScript forwarders module.
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeForwarders } from "./forwarders.ts";
import { writeSitemap } from "./sitemap.ts";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(web, process.env.DATA_DIR ?? "../data");
const pub = join(web, "public");
if (!existsSync(src)) throw new Error(`DATA_DIR not found: ${src}`);
rmSync(pub, { recursive: true, force: true });
cpSync(src, pub, { recursive: true, filter: (p) => !/[/\\]\./.test(p.slice(src.length)) });
const json = (f) => JSON.parse(readFileSync(join(src, f), "utf-8"));
const n = writeForwarders(pub, json("heroes_ko.json"), json("maps_ko.json"));
const urls = writeSitemap(pub, json("heroes_ko.json"), json("maps_ko.json"));
console.log(`synced ${src} -> public/ (+${n} forwarding pages, robots.txt, sitemap.xml with ${urls} pages)`);
