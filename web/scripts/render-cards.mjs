// 카드뉴스 (owner 2026-10-07): data/weekly/<week>.analysis.json `cards` → data/weekly/cards/<week>/01.png … (1080×1350),
// for the community post and the report page. usage: npm run cards -- 2026-w41
// Run with Node's type stripping (package.json) so it can load the TypeScript card module.
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { cardsDocument } from "../src/lib/cards.ts";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const week = process.argv[2];
if (!/^\d{4}-w\d{2}$/.test(week ?? "")) throw new Error("usage: npm run cards -- <yyyy-wNN>");
const data = resolve(web, process.env.DATA_DIR ?? "../data");
const analysis = JSON.parse(readFileSync(join(data, "weekly", `${week}.analysis.json`), "utf-8"));
const cards = analysis.cards ?? [];
if (!cards.length) throw new Error(`${week}.analysis.json has no cards`);
const out = join(data, "weekly", "cards", week);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
await page.setContent(cardsDocument(cards), { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
const sections = page.locator("section.card");
for (let i = 0; i < cards.length; i++) {
  await sections.nth(i).screenshot({ path: join(out, `${String(i + 1).padStart(2, "0")}.png`) });
}
await browser.close();
console.log(`rendered ${cards.length} cards -> ${out}`);
