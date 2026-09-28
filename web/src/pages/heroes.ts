import { computeTiers, PRESETS, type Tier } from "../formula";
import { assetUrl, loadHeroes, loadMeta, loadSnapshot, type Mode } from "../data";
import { mountFooter, mountNav } from "../lib/nav";

/** 영웅: portrait grid with the current tier badge; search + role filter; links to hero.html. */
async function main(): Promise<void> {
  mountNav("heroes");
  mountFooter();
  const q = new URLSearchParams(location.search);
  let mode: Mode = q.get("mode") === "sl" ? "sl" : "qm";
  let role = q.get("role") ?? "all";
  let query = "";
  const [meta, heroes] = await Promise.all([loadMeta(), loadHeroes()]);
  const snaps: Partial<Record<Mode, Awaited<ReturnType<typeof loadSnapshot>>>> = {};
  const grid = document.getElementById("grid")!;
  const rolesEl = document.getElementById("roles")!;
  const search = document.getElementById("search") as HTMLInputElement;
  const list = [...heroes.heroes].sort((a, b) => a.ko.localeCompare(b.ko, "ko"));
  document.getElementById("count")!.textContent = `${list.length}`;

  for (const r of [{ name: "all", ko: "전체" }, ...heroes.roles]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.dataset.role = r.name;
    b.textContent = r.ko;
    b.addEventListener("click", () => {
      role = r.name;
      render();
    });
    rolesEl.appendChild(b);
  }
  document.getElementById("mode-qm")!.addEventListener("click", () => {
    mode = "qm";
    void render();
  });
  document.getElementById("mode-sl")!.addEventListener("click", () => {
    mode = "sl";
    void render();
  });
  search.addEventListener("input", () => {
    query = search.value.trim().toLowerCase();
    void render();
  });

  async function render(): Promise<void> {
    snaps[mode] ??= await loadSnapshot(mode, "current");
    const snap = snaps[mode]!;
    const tiers = computeTiers(snap.rows.filter((r) => r.map === "all"), PRESETS.aichi, meta.min_games_for_tier);
    const tierOf = new Map<string, Tier>(tiers.ranked.map((x) => [x.row.hero, x.tier]));
    document.getElementById("mode-qm")!.setAttribute("aria-pressed", String(mode === "qm"));
    document.getElementById("mode-sl")!.setAttribute("aria-pressed", String(mode === "sl"));
    for (const b of rolesEl.querySelectorAll<HTMLButtonElement>(".chip")) b.setAttribute("aria-pressed", String(b.dataset.role === role));
    document.getElementById("meta-line")!.textContent = `${mode === "qm" ? "빠른 대전" : "스톰 리그"} 티어 · 패치 ${snap.patch} · 이름을 누르면 상세로`;
    const qs = new URLSearchParams();
    if (mode !== "qm") qs.set("mode", mode);
    if (role !== "all") qs.set("role", role);
    history.replaceState(null, "", location.pathname + (qs.toString() ? `?${qs}` : ""));

    grid.innerHTML = "";
    for (const h of list) {
      if (role !== "all" && h.role !== role) continue;
      if (query && !h.ko.toLowerCase().includes(query) && !h.name.toLowerCase().includes(query)) continue;
      const a = document.createElement("a");
      a.className = "hero-card";
      a.href = `./hero.html?hero=${encodeURIComponent(h.slug)}`;
      a.dataset.hero = h.slug;
      const t = tierOf.get(h.name);
      a.innerHTML = `<img alt="" loading="lazy" width="56" height="56" src="${h.portrait ? assetUrl(h.portrait) : ""}" /><span class="hname">${h.ko}</span><span class="muted">${h.role_ko}</span>${t ? `<span class="badge badge-${t} badge-sm">${t}</span>` : ""}`;
      grid.appendChild(a);
    }
  }
  await render();
}

main().catch((e: unknown) => {
  document.getElementById("meta-line")!.textContent = `데이터를 불러오지 못했습니다: ${e instanceof Error ? e.message : String(e)}`;
});
