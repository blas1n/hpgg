import { computeTiers, PRESETS, type Ranked } from "../formula";
import { assetUrl, loadHeroes, loadMaps, loadMeta, loadSnapshot, type Mode } from "../data";
import { mountFooter, mountNav } from "../lib/nav";

const fmt1 = (n: number) => n.toFixed(1);

/** 홈: role leaders, movers vs the previous patch, and a few maps — every card links deeper. */
async function main(): Promise<void> {
  mountNav("home");
  mountFooter();
  let mode: Mode = new URLSearchParams(location.search).get("mode") === "sl" ? "sl" : "qm";
  const [meta, heroes, maps] = await Promise.all([loadMeta(), loadHeroes(), loadMaps()]);
  const byName = new Map(heroes.heroes.map((h) => [h.name, h]));
  document.getElementById("mode-qm")!.addEventListener("click", () => {
    mode = "qm";
    void render();
  });
  document.getElementById("mode-sl")!.addEventListener("click", () => {
    mode = "sl";
    void render();
  });

  async function render(): Promise<void> {
    document.getElementById("mode-qm")!.setAttribute("aria-pressed", String(mode === "qm"));
    document.getElementById("mode-sl")!.setAttribute("aria-pressed", String(mode === "sl"));
    history.replaceState(null, "", location.pathname + (mode === "sl" ? "?mode=sl" : ""));
    const snap = await loadSnapshot(mode, "current");
    const prev = meta.previous_patch ? await loadSnapshot(mode, "previous").catch(() => null) : null;
    const all = snap.rows.filter((r) => r.map === "all");
    const tiers = computeTiers(all, PRESETS.aichi, meta.min_games_for_tier);
    document.getElementById("meta-line")!.textContent = `${mode === "qm" ? "빠른 대전" : "폭풍 리그"} · 패치 ${snap.patch} · ${snap.matches.toLocaleString("ko-KR")} 매치 · ${snap.collected_at.slice(5, 10).replace("-", "/")} 갱신`;

    // role leaders
    const strip = document.getElementById("role-top")!;
    strip.innerHTML = "";
    for (const role of heroes.roles) {
      const top = tiers.ranked.find((x) => byName.get(x.row.hero)?.role === role.name);
      if (!top) continue;
      const h = byName.get(top.row.hero)!;
      const a = document.createElement("a");
      a.className = "role-card";
      a.href = `./hero.html?hero=${encodeURIComponent(h.slug)}${mode === "sl" ? "&mode=sl" : ""}`;
      a.dataset.role = role.name;
      a.innerHTML = `<img alt="" loading="lazy" src="${h.portrait ? assetUrl(h.portrait) : ""}" /><span><span class="rk">${role.ko}</span><br><span class="rn">${h.ko}</span> <span class="badge badge-${top.tier} badge-sm">${top.tier}</span><br><span class="rs">승률 ${fmt1(top.row.win_rate)}% · 픽률 ${fmt1(top.row.pick)}%${mode === "sl" ? ` · 밴률 ${fmt1(top.row.ban_rate)}%` : ""}</span></span>`;
      strip.appendChild(a);
    }

    // movers vs previous patch: biggest rank changes (both directions), top 6
    const movers = document.getElementById("movers")!;
    const sub = document.getElementById("movers-sub")!;
    movers.innerHTML = "";
    if (prev) {
      const prevRank = new Map(computeTiers(prev.rows.filter((r) => r.map === "all"), PRESETS.aichi, meta.min_games_for_tier).ranked.map((x) => [x.row.hero, x]));
      const deltas = tiers.ranked
        .map((x) => ({ x, p: prevRank.get(x.row.hero) }))
        .filter((d): d is { x: Ranked; p: Ranked } => !!d.p)
        .map((d) => ({ ...d, delta: d.p.rank - d.x.rank }))
        .filter((d) => d.delta !== 0)
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        .slice(0, 6);
      sub.textContent = `직전 패치 ${meta.previous_patch} 대비 순위 변동`;
      for (const d of deltas) {
        const h = byName.get(d.x.row.hero)!;
        const a = document.createElement("a");
        a.className = "mover-row";
        a.href = `./hero.html?hero=${encodeURIComponent(h.slug)}${mode === "sl" ? "&mode=sl" : ""}`;
        a.dataset.hero = h.slug;
        const up = d.delta > 0;
        a.innerHTML = `<img alt="" loading="lazy" src="${h.portrait ? assetUrl(h.portrait) : ""}" /><span><span class="rn">${h.ko}</span> <span class="badge badge-${d.x.tier} badge-sm">${d.x.tier}</span><br><span class="muted">#${d.p.rank} → #${d.x.rank} · 승률 ${fmt1(d.p.row.win_rate)}% → ${fmt1(d.x.row.win_rate)}%</span></span><span class="big ${up ? "delta up" : "delta down"}">${up ? "▲" : "▼"}${Math.abs(d.delta)}</span>`;
        movers.appendChild(a);
      }
      if (!deltas.length) sub.textContent = "직전 패치와 순위 변동 없음";
    } else {
      sub.textContent = "직전 패치 데이터가 쌓이면 표시됩니다";
    }

    // maps: 6 with the most matches in SL
    const grid = document.getElementById("map-grid")!;
    grid.innerHTML = "";
    const sl = mode === "sl" ? snap : await loadSnapshot("sl", "current");
    const cards = maps.maps
      .map((m) => ({ m, matches: Math.round(sl.rows.filter((r) => r.map === m.name).reduce((a, r) => a + r.games, 0) / 10) }))
      .sort((a, b) => b.matches - a.matches)
      .slice(0, 6);
    for (const { m, matches } of cards) {
      const a = document.createElement("a");
      a.className = "map-card";
      a.href = `./tier.html?mode=sl&map=${encodeURIComponent(m.name)}`;
      a.dataset.map = m.slug;
      a.innerHTML = `<img class="map-img" alt="" loading="lazy" src="${m.image ? assetUrl(m.image) : ""}" /><span class="map-body"><span class="map-name">${m.ko}</span><span class="map-sub">${matches.toLocaleString("ko-KR")} 매치 · 폭풍 리그</span></span>`;
      grid.appendChild(a);
    }
  }
  await render();
}

main().catch((e: unknown) => {
  document.getElementById("meta-line")!.textContent = `데이터를 불러오지 못했습니다: ${e instanceof Error ? e.message : String(e)}`;
});
