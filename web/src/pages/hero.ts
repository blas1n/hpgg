import { computeTiers, PRESETS, type Snapshot } from "../formula";
import { wilson } from "../wilson";
import { assetUrl, loadBuilds, loadHeroes, loadMaps, loadMeta, loadSnapshot, loadTalents, type Meta, type Mode } from "../data";
import { mountFooter, mountNav } from "../lib/nav";

const fmt1 = (n: number) => n.toFixed(1);
const fmtInt = (n: number) => n.toLocaleString("ko-KR");
const BRACKETS: { key: string; label: string }[] = [
  { key: "sl_low", label: "브론즈 – 실버" },
  { key: "sl_mid", label: "골드 – 플래티넘" },
  { key: "sl_high", label: "다이아 – 마스터" },
];

async function main(): Promise<void> {
  mountNav("heroes");
  mountFooter();
  const q = new URLSearchParams(location.search);
  const slug = q.get("hero") ?? "";
  let mode: Mode = q.get("mode") === "sl" ? "sl" : "qm";
  const [meta, heroes, maps, builds, talents] = await Promise.all([loadMeta(), loadHeroes(), loadMaps(), loadBuilds(), loadTalents()]);
  const info = heroes.heroes.find((h) => h.slug === slug);
  if (!info) {
    document.getElementById("meta-line")!.textContent = "그런 영웅이 없습니다.";
    return;
  }
  document.title = `${info.ko} | 히오스 티어표 hotsmeta.kr`;
  const head = document.getElementById("hero-head")!;
  head.innerHTML = `<div class="portrait"><img alt="" src="${info.portrait ? assetUrl(info.portrait) : ""}" /><span class="badge badge-lg" id="head-badge" hidden></span></div><div><h1>${info.ko}</h1><div class="muted">${info.name} · ${info.role_ko}</div><p class="meta" id="meta-line"></p></div>`;
  const cache: Record<string, Snapshot> = {};
  const get = async (key: string, patch: "current" | "previous" = "current"): Promise<Snapshot | null> => {
    const k = `${key}:${patch}`;
    if (!(k in cache)) {
      try {
        cache[k] = await loadSnapshot(key as Mode, patch);
      } catch {
        return null;
      }
    }
    return cache[k] ?? null;
  };

  const pick = (snap: Snapshot, map: string) => {
    const t = computeTiers(snap.rows.filter((x) => x.map === map), PRESETS.aichi, meta.min_games_for_tier);
    const r = t.ranked.find((x) => x.row.hero === info.name);
    const grey = t.grey.find((x) => x.hero === info.name);
    return { r, grey, n: t.ranked.length };
  };

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
    const qs = new URLSearchParams({ hero: slug });
    if (mode !== "qm") qs.set("mode", mode);
    history.replaceState(null, "", `${location.pathname}?${qs}`);

    const snap = await get(mode);
    if (!snap) return;
    const prev = meta.previous_patch ? await get(mode, "previous") : null;
    const { r, grey, n } = pick(snap, "all");
    const pr = prev ? pick(prev, "all").r : undefined;
    const other = await get(mode === "qm" ? "sl" : "qm");
    const ro = other ? pick(other, "all").r : undefined;

    document.getElementById("meta-line")!.textContent = `${mode === "qm" ? "빠른 대전" : "폭풍 리그"} · 패치 ${snap.patch} · ${snap.collected_at.slice(5, 10).replace("-", "/")} 갱신`;
    const stats = document.getElementById("stats")!;
    stats.innerHTML = "";
    const card = (k: string, v: string, s: string, cls = "") => {
      const d = document.createElement("div");
      d.className = "stat-card " + cls;
      d.innerHTML = `<div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div>`;
      stats.appendChild(d);
    };
    const hb = document.getElementById("head-badge")!;
    if (r) {
      hb.hidden = false;
      hb.className = `badge badge-lg badge-${r.tier}`;
      hb.textContent = r.tier;
    } else hb.hidden = true;
    if (r) {
      const d = pr ? pr.rank - r.rank : null;
      const delta = d === null ? (prev ? "직전 패치 표본 부족" : "") : d === 0 ? "직전 패치와 같음" : d > 0 ? `▲ ${d} (직전 #${pr!.rank})` : `▼ ${-d} (직전 #${pr!.rank})`;
      card("티어", `<span class="badge badge-${r.tier}">${r.tier}</span> #${r.rank}`, `${n}명 중 · ${delta}`);
      const [lo, hi] = wilson(r.row.wins, r.row.games);
      card("승률", `${fmt1(r.row.win_rate)}%`, `±${fmt1((hi - lo) / 2)} · ${fmtInt(r.row.games)}게임`);
      card("픽률", `${fmt1(r.row.pick)}%`, mode === "sl" ? `밴률 ${fmt1(r.row.ban_rate)}%` : "빠른 대전은 밴 없음");
      card("점수", `${r.score >= 0 ? "+" : ""}${r.score.toFixed(0)}`, ro ? `${mode === "qm" ? "폭풍 리그" : "빠른 대전"}에선 ${ro.tier} #${ro.rank}` : "");
    } else if (grey) {
      card("티어", "–", `표본 부족 (${fmtInt(grey.games)}게임 < ${meta.min_games_for_tier})`);
      card("승률", `${fmt1(grey.win_rate)}%`, `${fmtInt(grey.games)}게임`);
      card("픽률", `${fmt1(grey.pick)}%`, "");
    } else {
      card("데이터 없음", "–", "이 모드에 표본이 없습니다");
    }

    // per-map win rate (this hero), sorted desc, bar centred on the mode average (50)
    const mapsEl = document.getElementById("maps")!;
    mapsEl.innerHTML = "";
    const perMap = maps.maps
      .map((m) => ({ m, row: snap.rows.find((x) => x.map === m.name && x.hero === info!.name) }))
      .filter((x): x is { m: (typeof maps.maps)[number]; row: NonNullable<typeof x.row> } => !!x.row)
      .sort((a, b) => b.row.win_rate - a.row.win_rate);
    const span = Math.max(...perMap.map((x) => Math.abs(x.row.win_rate - 50)), 5);
    for (const { m, row } of perMap) {
      const a = document.createElement("a");
      a.className = "rowbar" + (row.win_rate < 50 ? " neg" : "");
      a.href = `./tier.html?mode=${mode}&map=${encodeURIComponent(m.name)}`;
      a.dataset.map = m.slug;
      const thin = row.games < meta.min_games_for_tier;
      a.innerHTML = `<img alt="" loading="lazy" src="${m.image ? assetUrl(m.image) : ""}" /><span><span class="lbl">${m.ko}</span> <span class="sub">${fmtInt(row.games)}게임${thin ? " · 표본 부족" : ""}</span><span class="bar"><i style="width:${Math.min(100, (Math.abs(row.win_rate - 50) / span) * 100)}%"></i></span></span><span class="val">${fmt1(row.win_rate)}%<br><span class="sub">픽 ${fmt1(row.pick)}%</span></span>`;
      mapsEl.appendChild(a);
    }
    document.getElementById("maps-title")!.textContent = mode === "sl" ? "전장별 승률 (폭풍 리그)" : "전장별 승률 (빠른 대전)";

    // brackets (SL only)
    const bt = document.getElementById("brackets-title")!;
    const bEl = document.getElementById("brackets")!;
    bEl.innerHTML = "";
    document.getElementById("nav-brackets")!.hidden = mode !== "sl";
    if (mode === "sl") {
      bt.hidden = false;
      bEl.hidden = false;
      for (const b of BRACKETS) {
        const s = await get(b.key);
        if (!s) continue;
        const p = pick(s, "all");
        const row = p.r?.row ?? p.grey;
        if (!row) continue;
        const d = document.createElement("div");
        d.className = "rowbar" + (row.win_rate < 50 ? " neg" : "");
        d.dataset.bracket = b.key;
        d.innerHTML = `<span class="badge ${p.r ? `badge-${p.r.tier}` : ""}">${p.r ? p.r.tier : "–"}</span><span><span class="lbl">${b.label}</span> <span class="sub">${p.r ? `#${p.r.rank} / ${p.n}` : "표본 부족"} · ${fmtInt(row.games)}게임</span><span class="bar"><i style="width:${Math.min(100, (Math.abs(row.win_rate - 50) / 10) * 100)}%"></i></span></span><span class="val">${fmt1(row.win_rate)}%<br><span class="sub">픽 ${fmt1(row.pick)}% · 밴 ${fmt1(row.ban_rate)}%</span></span>`;
        bEl.appendChild(d);
      }
    } else {
      bt.hidden = true;
      bEl.hidden = true;
    }

    // votes (same key as the table)
    const voteKey = `vote:${mode}:${slug}`;
    let existing: string | null = null;
    try {
      existing = localStorage.getItem(voteKey);
    } catch {
      /* ignore */
    }
    for (const b of document.querySelectorAll<HTMLButtonElement>("#vote .vote-btn")) {
      const v = b.dataset.vote as "up" | "down";
      b.disabled = !!existing;
      b.setAttribute("aria-pressed", String(existing === v));
      b.onclick = () => {
        if (existing) return;
        existing = v;
        try {
          localStorage.setItem(voteKey, v);
        } catch {
          /* ignore */
        }
        (window as unknown as { goatcounter?: { count: (o: { path: string; event: boolean }) => void } }).goatcounter?.count({ path: `vote/${mode}/${slug}/${v}`, event: true });
        for (const bb of document.querySelectorAll<HTMLButtonElement>("#vote .vote-btn")) {
          bb.disabled = true;
          bb.setAttribute("aria-pressed", String(bb === b));
        }
      };
    }
  }
  await render();
  renderBuilds();

  function renderBuilds(): void {
    const title = document.getElementById("builds-title")!;
    const box = document.getElementById("builds")!;
    const list = builds?.heroes[info!.name] ?? [];
    if (!builds || !list.length) {
      title.hidden = true;
      box.hidden = true;
      return;
    }
    title.hidden = false;
    box.hidden = false;
    document.getElementById("nav-builds")!.hidden = false;
    document.getElementById("builds-sub")!.textContent = `빠른 대전 + 폭풍 리그 합산 · 패치 ${builds.patch} · 많이 쓴 순`;
    box.innerHTML = "";
    const maxGames = Math.max(...list.map((b) => b.games), 1);
    list.forEach((b, i) => {
      const card = document.createElement("div");
      card.className = "build" + (b.win_rate < 50 ? " neg" : "");
      card.dataset.build = String(i + 1);
      const row = document.createElement("div");
      row.className = "build-talents";
      for (const t of b.talents) {
        const meta = talents?.talents[t.name];
        const cell = document.createElement("span");
        cell.className = "talent";
        cell.title = `${t.level}레벨 · ${meta?.ko ?? t.title}`;
        cell.innerHTML = `${meta?.icon ? `<img alt="" loading="lazy" src="${assetUrl(`img/talents/${meta.icon}`)}" onerror="this.remove()" />` : ""}<span class="tl">${t.level}</span><span class="tn">${meta?.ko ?? t.title}</span>`;
        row.appendChild(cell);
      }
      const stats = document.createElement("div");
      stats.className = "build-stats";
      stats.innerHTML = `<span class="v">${fmt1(b.win_rate)}%</span><span class="sub">승률</span><span class="v2">${fmtInt(b.games)}</span><span class="sub">게임</span><span class="bar"><i style="width:${(b.games / maxGames) * 100}%"></i></span>`;
      card.append(row, stats);
      box.appendChild(card);
    });
  }
}

main().catch((e: unknown) => {
  document.getElementById("meta-line")!.textContent = `데이터를 불러오지 못했습니다: ${e instanceof Error ? e.message : String(e)}`;
});
