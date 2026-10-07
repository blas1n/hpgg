/** 카드뉴스 (owner 2026-10-07: "카드 뉴스는 이대로 가져가고"): the weekly report as 1080×1350 cards — one claim and one
 *  number each — for the community post and the report page. <week>.analysis.json `cards` holds them; this draws them
 *  as one HTML document that web/scripts/render-cards.mjs photographs card by card. Pure. The look is the approved
 *  mock (2026-10-07): a dark card, the claim large, one figure in cyan. */

export type Card =
  | { type: "cover"; section: string; tag?: string; title: string; lede: string; foot: string }
  | { type: "stat"; section: string; big: string; unit?: string; title: string; lede: string; foot: string }
  | { type: "bars"; section: string; title: string; bars: { name: string; value: number; hl?: boolean }[]; foot: string }
  | {
      type: "compare";
      section: string;
      title: string;
      boxes: { k: string; from?: string; to: string; s: string; dir?: "up" | "down" }[];
      note?: string;
      foot: string;
    }
  | { type: "list"; section: string; title: string; items: { text: string; chip?: string }[]; note?: string; foot: string }
  | { type: "closing"; section: string; title: string; lede: string; foot: string };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** a title may set one phrase apart with <em>…</em>; everything else is text */
const titled = (s: string) => esc(s).replace(/&lt;em&gt;(.*?)&lt;\/em&gt;/g, "<em>$1</em>").replace(/\n/g, "<br>");

const CSS = `
:root{--ink:#eef3fb;--muted:#93a3bd;--line:#24314a;--card:#0d1526;--panel:#121d33;--cyan:#3fd0ff;--void:#a98bff;--up:#4fd18b;--down:#ff6b6b;--warn:#ffb547;
--sans:"Noto Sans KR",system-ui,sans-serif;--mono:"IBM Plex Mono",ui-monospace,monospace;color-scheme:dark}
*{box-sizing:border-box}body{margin:0;background:#070c17;color:var(--ink);font-family:var(--sans)}
.card{width:1080px;height:1350px;overflow:hidden;position:relative;background:
radial-gradient(900px 600px at 85% -10%,rgba(63,208,255,.13),transparent 60%),radial-gradient(700px 500px at -10% 110%,rgba(169,139,255,.12),transparent 60%),var(--card);
padding:84px 80px;display:flex;flex-direction:column;gap:36px}
.top{display:flex;justify-content:space-between;align-items:center;color:var(--muted);font-size:28px;font-weight:700}
.top .no{font-family:var(--mono);color:var(--cyan)}
.tag{align-self:flex-start;font-size:26px;font-weight:700;color:var(--warn);border:2px solid var(--warn);border-radius:10px;padding:4px 14px}
h2{margin:0;font-size:76px;line-height:1.18;font-weight:900;letter-spacing:-.02em;word-break:keep-all}
h2 em{font-style:normal;color:var(--cyan)}
.lede{margin:0;font-size:36px;line-height:1.55;color:#c9d4e6;word-break:keep-all}
.big{font-family:var(--mono);font-size:230px;font-weight:700;line-height:.9;color:var(--cyan);letter-spacing:-.04em}
.big small{font-size:90px}
.foot{margin-top:auto;display:flex;justify-content:space-between;align-items:flex-end;color:var(--muted);font-size:24px}
.brand{font-weight:900;font-size:34px;color:var(--ink)}.brand b{color:var(--cyan)}
.bars{display:grid;gap:22px}
.bar{display:grid;grid-template-columns:200px 1fr 130px;align-items:center;gap:22px;font-size:36px;font-weight:700}
.track{height:40px;border-radius:8px;background:var(--panel);overflow:hidden}.fill{display:block;height:100%;border-radius:8px;background:var(--void)}
.bar.hl .fill{background:var(--cyan)}.bar .v{font-family:var(--mono);text-align:right}
.split{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:28px}
.box{background:var(--panel);border:2px solid var(--line);border-radius:22px;padding:34px 30px;display:grid;gap:10px;min-width:0}
.box .k{font-size:28px;color:var(--muted);font-weight:700}.box .n{font-family:var(--mono);font-size:64px;font-weight:700;line-height:1.05;white-space:nowrap}
.box .s{font-size:26px;color:var(--muted)}.up{color:var(--up)}.down{color:var(--down)}
.note{margin:0;font-size:26px;color:var(--muted);line-height:1.6;word-break:keep-all}
ul{margin:0;padding-left:44px;display:grid;gap:16px;font-size:36px;line-height:1.45}
.chip{font-size:24px;font-weight:700;border-radius:999px;padding:4px 14px;border:2px solid currentColor;margin-left:10px;color:var(--warn)}`;

function body(c: Card): string {
  switch (c.type) {
    case "cover":
      return `${c.tag ? `<span class="tag">${esc(c.tag)}</span>` : ""}<h2>${titled(c.title)}</h2><p class="lede">${esc(c.lede)}</p>`;
    case "stat":
      return `<div class="big">${esc(c.big)}${c.unit ? `<small>${esc(c.unit)}</small>` : ""}</div><h2>${titled(c.title)}</h2><p class="lede">${esc(c.lede)}</p>`;
    case "bars":
      return `<h2>${titled(c.title)}</h2><div class="bars">${c.bars
        .map(
          (b) =>
            `<div class="bar${b.hl ? " hl" : ""}"><span>${esc(b.name)}</span><span class="track"><span class="fill" style="width:${Math.max(0, Math.min(100, b.value))}%"></span></span><span class="v">${Math.round(b.value)}%</span></div>`,
        )
        .join("")}</div>`;
    case "compare":
      return `<h2>${titled(c.title)}</h2><div class="split">${c.boxes
        .map(
          (b) =>
            `<div class="box"><span class="k">${esc(b.k)}</span><span class="n">${b.from ? `${esc(b.from)}<span class="${b.dir ?? ""}">→</span>` : ""}${esc(b.to)}</span><span class="s">${esc(b.s)}</span></div>`,
        )
        .join("")}</div>${c.note ? `<p class="note">${esc(c.note)}</p>` : ""}`;
    case "list":
      return `<h2>${titled(c.title)}</h2><ul>${c.items.map((i) => `<li>${esc(i.text)}${i.chip ? `<span class="chip">${esc(i.chip)}</span>` : ""}</li>`).join("")}</ul>${c.note ? `<p class="note">${esc(c.note)}</p>` : ""}`;
    case "closing":
      return `<h2>${titled(c.title)}</h2><p class="lede">${esc(c.lede)}</p>`;
  }
}

/** Every card as one HTML document; each `.card` is exactly 1080×1350 for a 1:1 screenshot. */
export function cardsDocument(cards: Card[]): string {
  const n = cards.length;
  const each = cards
    .map(
      (c, i) =>
        `<section class="card" style="width:1080px;height:1350px" data-card="${i + 1}"><div class="top"><span>${esc(c.section)}</span><span class="no">${i + 1} / ${n}</span></div>${body(c)}<div class="foot"><span>${esc(c.foot)}</span><span class="brand">hp<b>gg</b>.win</span></div></section>`,
    )
    .join("");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&family=IBM+Plex+Mono:wght@500;700&display=swap"><style>${CSS}</style></head><body>${each}</body></html>`;
}
