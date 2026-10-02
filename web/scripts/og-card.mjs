// The link-preview cards data/img/brand/og-<locale>.png (1200×630; tests/og.test.ts). Run by hand when the copy or
// the brand changes, not in the build: `node scripts/og-card.mjs` from web/ (Playwright's Chromium, Pretendard from
// the CDN the site uses). The text says what the site is, not today's numbers, so the card does not go stale.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const data = resolve(web, "../data");
const b64 = (p) => `data:image/png;base64,${readFileSync(join(data, p)).toString("base64")}`;

// one hero per role and universe, recognisable at 72 px
const HEROES = ["illidan", "jaina", "kerrigan", "tracer", "diablo", "valla", "muradin", "li-li", "zeratul", "anduin"];

const COPY = {
  ko: {
    lang: "ko",
    title: "히어로즈 오브 더 스톰<br>티어표 · 영웅 통계 · 전적 검색",
    sub: "빠른 대전 · 폭풍 리그 · 지역 × 구간 · 계산식 공개 · 매일 새벽 갱신",
  },
  en: {
    lang: "en",
    title: "Heroes of the Storm<br>tier list · hero stats · player search",
    sub: "Quick Match · Storm League · region × bracket · formula shown · updated daily",
  },
};

const html = (c) => `<!doctype html><html lang="${c.lang}"><head><meta charset="utf-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<style>
  * { margin: 0; box-sizing: border-box; }
  body { width: 1200px; height: 630px; font-family: "Pretendard Variable", sans-serif; color: #e8ecf4;
    background: radial-gradient(900px 500px at 85% 0%, #1d3350 0%, transparent 60%),
                radial-gradient(700px 400px at 0% 100%, #1a2a24 0%, transparent 60%), #0e1118;
    padding: 64px 72px; display: flex; flex-direction: column; }
  .brand { display: flex; align-items: center; gap: 18px; }
  .brand img { width: 72px; height: 72px; }
  .word { font-size: 52px; font-weight: 800; letter-spacing: -1px; }
  .word span { color: #4fd1ff; font-size: 34px; }
  .tag { margin-left: auto; font-size: 22px; color: #8a93a8; }
  h1 { margin-top: 56px; font-size: 54px; line-height: 1.22; font-weight: 800; letter-spacing: -1px; }
  .sub { margin-top: 22px; font-size: 25px; color: #3ee6a1; font-weight: 600; }
  .row { margin-top: auto; display: flex; align-items: center; gap: 12px; }
  .row img { width: 64px; height: 64px; border-radius: 12px; border: 2px solid #2a3245; }
  .credit { margin-left: auto; font-size: 20px; color: #8a93a8; }
  .credit b { color: #4fd1ff; font-weight: 600; }
</style></head><body>
  <div class="brand"><img src="${b64("img/brand/icon.png")}"><div class="word">hpgg<span>.win</span></div><div class="tag">Happy Good Game</div></div>
  <h1>${c.title}</h1>
  <div class="sub">${c.sub}</div>
  <div class="row">${HEROES.map((h) => `<img src="${b64(`img/heroes/${h}.png`)}">`).join("")}
    <div class="credit">Data provided by <b>Heroes Profile</b></div></div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
for (const [locale, c] of Object.entries(COPY)) {
  await page.setContent(html(c), { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const out = join(data, `img/brand/og-${locale}.png`);
  await page.screenshot({ path: out });
  console.log(`wrote ${out}`);
}
await browser.close();
