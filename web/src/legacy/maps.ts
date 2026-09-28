import { computeTiers, PRESETS } from "../formula";
import { assetUrl, hotsHref, loadHeroes, loadMaps, loadMeta, loadSnapshot } from "../data";

/** 전장: one card per ranked map (image, match count, top hero per role in Storm League). */
async function main(): Promise<void> {
  const [meta, heroes, maps] = await Promise.all([loadMeta(), loadHeroes(), loadMaps()]);
  const sl = await loadSnapshot("sl", "current");
  const byName = new Map(heroes.heroes.map((h) => [h.name, h]));
  const grid = document.getElementById("map-grid")!;
  const tpl = document.getElementById("tpl-map") as HTMLTemplateElement;
  document.getElementById("meta-line")!.textContent = `폭풍 리그 · 패치 ${sl.patch} · ${sl.matches.toLocaleString("ko-KR")} 매치 · ${sl.collected_at.slice(5, 10).replace("-", "/")} 갱신 · 전장을 누르면 그 전장의 티어표로 갑니다.`;

  const cards = maps.maps.map((m) => {
    const rows = sl.rows.filter((r) => r.map === m.name);
    const matches = Math.round(rows.reduce((a, r) => a + r.games, 0) / 10);
    const tiers = computeTiers(rows, PRESETS.aichi, meta.min_games_for_tier);
    const top = tiers.ranked.slice(0, 3);
    return { m, matches, top };
  });
  cards.sort((a, b) => b.matches - a.matches);

  for (const { m, matches, top } of cards) {
    const el = (tpl.content.firstElementChild as HTMLAnchorElement).cloneNode(true) as HTMLAnchorElement;
    el.href = hotsHref.tier(new URLSearchParams({ mode: "sl", map: m.name }));
    el.dataset.map = m.slug;
    const img = el.querySelector<HTMLImageElement>(".map-img")!;
    if (m.image) img.src = assetUrl(m.image);
    else img.remove();
    el.querySelector(".map-name")!.textContent = m.ko;
    el.querySelector(".map-sub")!.textContent = `${m.name} · ${matches.toLocaleString("ko-KR")} 매치`;
    const topEl = el.querySelector<HTMLElement>(".map-top")!;
    topEl.innerHTML = "";
    for (const x of top) {
      const h = byName.get(x.row.hero);
      const s = document.createElement("span");
      s.className = "map-top-hero";
      s.title = `${h?.ko ?? x.row.hero} ${x.row.win_rate.toFixed(1)}%`;
      if (h?.portrait) {
        const i = document.createElement("img");
        i.src = assetUrl(h.portrait);
        i.alt = h.ko;
        i.width = 26;
        i.height = 26;
        i.loading = "lazy";
        s.appendChild(i);
      }
      const b = document.createElement("span");
      b.className = `badge badge-${x.tier} badge-sm`;
      b.textContent = x.tier;
      s.appendChild(b);
      topEl.appendChild(s);
    }
    grid.appendChild(el);
  }
}

/** Mounted by the page component once its markup is in the DOM. */
export function run(): void {
  main().catch((e: unknown) => {
    document.getElementById("meta-line")!.textContent = `데이터를 불러오지 못했습니다: ${e instanceof Error ? e.message : String(e)}`;
  });
}
