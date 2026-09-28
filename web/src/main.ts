import { computeTiers, formulaLine, PRESETS, TIERS, type Ranked, type Row, type Snapshot, type Tier } from "./formula";
import { wilson } from "./wilson";
import {
  daysSince,
  loadHeroes,
  loadMaps,
  loadMeta,
  loadSnapshot,
  thinSample,
  type HeroInfo,
  type HeroTable,
  type MapTable,
  type Meta,
  type Mode,
  type PatchChoice,
} from "./data";

declare global {
  interface Window {
    goatcounter?: { count: (o: { path: string; event: boolean; title?: string }) => void };
  }
}

interface State {
  mode: Mode;
  map: string; // "all" or a map name
  role: string; // "all" or a role name
  patch: PatchChoice;
}

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};

const fmt1 = (n: number) => n.toFixed(1);
const fmtInt = (n: number) => n.toLocaleString("ko-KR");

function readState(): State {
  const q = new URLSearchParams(location.search);
  const mode: Mode = q.get("mode") === "sl" ? "sl" : "qm";
  return {
    mode,
    map: mode === "sl" ? (q.get("map") ?? "all") : "all",
    role: q.get("role") ?? "all",
    patch: q.get("patch") === "previous" ? "previous" : "current",
  };
}

function writeState(s: State): void {
  const q = new URLSearchParams();
  if (s.mode !== "qm") q.set("mode", s.mode);
  if (s.mode === "sl" && s.map !== "all") q.set("map", s.map);
  if (s.role !== "all") q.set("role", s.role);
  if (s.patch === "previous") q.set("patch", "previous");
  const qs = q.toString();
  history.replaceState(null, "", location.pathname + (qs ? `?${qs}` : ""));
}

const voteKey = (mode: Mode, slug: string) => `vote:${mode}:${slug}`;

function recordVote(mode: Mode, slug: string, vote: "up" | "down"): void {
  try {
    localStorage.setItem(voteKey(mode, slug), vote);
  } catch {
    /* private mode etc. — the click still counts as an event */
  }
  window.goatcounter?.count({ path: `vote/${mode}/${slug}/${vote}`, event: true, title: "vote" });
}

function readVote(mode: Mode, slug: string): string | null {
  try {
    return localStorage.getItem(voteKey(mode, slug));
  } catch {
    return null;
  }
}

class App {
  private meta!: Meta;
  private heroes!: HeroTable;
  private maps!: MapTable;
  private byName = new Map<string, HeroInfo>();
  private snapshot: Snapshot | null = null;
  private loadedKey = "";
  private state: State = readState();
  private autoPrevious = false;

  async start(): Promise<void> {
    [this.meta, this.heroes, this.maps] = await Promise.all([loadMeta(), loadHeroes(), loadMaps()]);
    for (const h of this.heroes.heroes) this.byName.set(h.name, h);
    this.renderRoles();
    this.renderMapOptions();
    this.bind();
    await this.refresh();
  }

  private bind(): void {
    $("#mode-qm").addEventListener("click", () => this.setMode("qm"));
    $("#mode-sl").addEventListener("click", () => this.setMode("sl"));
    $<HTMLSelectElement>("#map").addEventListener("change", (e) => {
      this.state.map = (e.target as HTMLSelectElement).value;
      void this.refresh();
    });
  }

  private setMode(mode: Mode): void {
    if (this.state.mode === mode) return;
    this.state.mode = mode;
    this.state.map = "all";
    this.state.patch = "current";
    void this.refresh();
  }

  private renderRoles(): void {
    const wrap = $("#roles");
    wrap.innerHTML = "";
    const roles = [{ name: "all", ko: "전체" }, ...this.heroes.roles];
    for (const r of roles) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.dataset.role = r.name;
      b.textContent = r.ko;
      b.setAttribute("aria-pressed", String(r.name === this.state.role));
      b.addEventListener("click", () => {
        this.state.role = r.name;
        this.render();
      });
      wrap.appendChild(b);
    }
  }

  private renderMapOptions(): void {
    const sel = $<HTMLSelectElement>("#map");
    sel.innerHTML = "";
    const all = document.createElement("option");
    all.value = "all";
    all.textContent = "전체 전장";
    sel.appendChild(all);
    for (const m of this.maps.maps) {
      const o = document.createElement("option");
      o.value = m.name;
      o.textContent = m.ko;
      sel.appendChild(o);
    }
  }

  private async refresh(): Promise<void> {
    const { mode } = this.state;
    // thin current patch → show the previous one by default (only when it exists)
    const q = new URLSearchParams(location.search);
    const forced = q.get("patch");
    this.autoPrevious = false;
    if (!forced && this.meta.previous_patch && thinSample(this.meta, mode)) {
      this.state.patch = "previous";
      this.autoPrevious = true;
    } else if (this.state.patch === "previous" && !this.meta.previous_patch) {
      this.state.patch = "current";
    }
    const key = `${mode}:${this.state.patch}`;
    if (this.loadedKey !== key) {
      this.snapshot = await loadSnapshot(mode, this.state.patch);
      this.loadedKey = key;
    }
    this.render();
  }

  private render(): void {
    const { mode, map, role, patch } = this.state;
    const snap = this.snapshot;
    if (!snap) return;
    writeState(this.state);

    $("#mode-qm").setAttribute("aria-pressed", String(mode === "qm"));
    $("#mode-sl").setAttribute("aria-pressed", String(mode === "sl"));
    for (const b of document.querySelectorAll<HTMLButtonElement>("#roles .chip")) {
      b.setAttribute("aria-pressed", String(b.dataset.role === role));
    }
    const mapWrap = $("#map-wrap");
    mapWrap.hidden = mode !== "sl";
    $<HTMLSelectElement>("#map").value = map;

    // banner
    const banner = $("#patch-banner");
    if (patch === "previous") {
      const days = daysSince(this.meta.patch_started_at);
      banner.hidden = false;
      banner.innerHTML = `패치 ${this.meta.current_patch} 후 ${days}일, 표본이 적어 <b>이전 패치(${this.meta.previous_patch})</b> 기준으로 보여줍니다. `;
      const sw = document.createElement("button");
      sw.type = "button";
      sw.className = "chip";
      sw.textContent = "현재 패치 보기";
      sw.addEventListener("click", () => {
        this.state.patch = "current";
        history.replaceState(null, "", location.pathname + "?patch=current");
        void this.refresh();
      });
      banner.appendChild(sw);
    } else if (this.autoPrevious === false && this.meta.previous_patch && thinSample(this.meta, mode)) {
      banner.hidden = false;
      banner.textContent = `패치 ${this.meta.current_patch} 후 ${daysSince(this.meta.patch_started_at)}일 — 표본이 아직 적습니다.`;
    } else {
      banner.hidden = true;
      banner.textContent = "";
    }

    // rows for the selected map; tiers are computed on the map subset (role filter only hides)
    const rows: Row[] = snap.rows.filter((r) => r.map === map);
    const tiers = computeTiers(rows, PRESETS.aichi, this.meta.min_games_for_tier);
    const hasBans = mode === "sl";

    const mapKo = map === "all" ? "전체 전장" : (this.maps.maps.find((m) => m.name === map)?.ko ?? map);
    const matches = map === "all" ? snap.matches : Math.round(rows.reduce((a, r) => a + r.games, 0) / 10);
    $("#meta-line").textContent = `${mode === "qm" ? "빠른 대전" : "스톰 리그"} · ${mapKo} · 패치 ${snap.patch} · ${fmtInt(matches)} 매치 · ${snap.collected_at.slice(0, 10)} 갱신`;

    const main = $("#tiers");
    main.innerHTML = "";
    const tpl = $<HTMLTemplateElement>("#tpl-hero");
    const byTier = new Map<Tier, Ranked[]>();
    for (const t of TIERS) byTier.set(t, []);
    for (const r of tiers.ranked) byTier.get(r.tier)?.push(r);
    for (const t of TIERS) {
      const list = (byTier.get(t) ?? []).filter((x) => this.roleOk(x.row.hero, role));
      if (!list.length) continue;
      const sec = document.createElement("section");
      sec.className = `tier tier-${t}`;
      sec.dataset.tier = t;
      const label = document.createElement("div");
      label.className = "tier-label";
      label.textContent = t;
      const heroes = document.createElement("div");
      heroes.className = "tier-heroes";
      for (const x of list) heroes.appendChild(this.heroCard(tpl, x, hasBans, tiers.ranked.length));
      sec.append(label, heroes);
      main.appendChild(sec);
    }

    const greyWrap = $("#grey-wrap");
    const grey = $("#grey");
    grey.innerHTML = "";
    const greyRows = tiers.grey.filter((r) => this.roleOk(r.hero, role));
    greyWrap.hidden = greyRows.length === 0;
    for (const r of greyRows) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.dataset.hero = this.slug(r.hero);
      chip.textContent = `${this.ko(r.hero)} · ${r.games}게임`;
      grey.appendChild(chip);
    }

    $("#formula").textContent = `${formulaLine(PRESETS.aichi, hasBans)} · 승률은 표본 수축(k=500) · 200게임 미만 제외 · 상위 6% S / 24% A / 54% B / 82% C / 94% D`;
    $("#formula-detail").innerHTML = `<pre>WRs   = 50 + (승률 − 50) × 게임수 / (게임수 + 500)
점수  = 픽률 × (WRs − 50) × 3${hasBans ? " + 밴률 × 1" : "   (빠른 대전은 밴이 없음)"}
티어  = 200게임 이상인 영웅을 점수순으로 세워 누적 비율로 자름 (S 6% · A 24% · B 54% · C 82% · D 94% · F 나머지)
        경계는 단조 증가, 티어마다 최소 1명
승률 ± 는 Wilson 95% 구간. 전장 하나를 고르면 그 전장의 표본으로만 계산합니다.
같은 데이터라도 공식이 다르면 티어가 다릅니다 — 이 사이트는 공식을 숨기지 않습니다.</pre>`;
  }

  private roleOk(hero: string, role: string): boolean {
    return role === "all" || this.byName.get(hero)?.role === role;
  }
  private ko(hero: string): string {
    return this.byName.get(hero)?.ko ?? hero;
  }
  private slug(hero: string): string {
    return this.byName.get(hero)?.slug ?? hero.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  }

  private heroCard(tpl: HTMLTemplateElement, x: Ranked, hasBans: boolean, n: number): HTMLElement {
    const el = (tpl.content.firstElementChild as HTMLElement).cloneNode(true) as HTMLElement;
    const r = x.row;
    const slug = this.slug(r.hero);
    el.dataset.hero = slug;
    el.dataset.tier = x.tier;
    el.querySelector(".name")!.textContent = this.ko(r.hero);
    el.querySelector(".en")!.textContent = r.hero;
    el.querySelector(".wr")!.textContent = `${fmt1(r.win_rate)}%`;
    el.querySelector(".rank")!.textContent = `${x.rank} / ${n}`;
    const [lo, hi] = wilson(r.wins, r.games);
    el.querySelector(".wr-ci")!.textContent = `${fmt1(r.win_rate)}% ±${fmt1((hi - lo) / 2)}`;
    el.querySelector(".pick")!.textContent = `${fmt1(r.pick)}%`;
    const banRow = el.querySelector<HTMLElement>(".ban-row")!;
    if (hasBans) el.querySelector(".ban")!.textContent = `${fmt1(r.ban_rate)}%`;
    else banRow.hidden = true;
    el.querySelector(".games")!.textContent = `${fmtInt(r.games)}게임`;
    el.querySelector(".score")!.textContent = x.score.toFixed(1);

    const existing = readVote(this.state.mode, slug);
    for (const b of el.querySelectorAll<HTMLButtonElement>(".vote-btn")) {
      const v = b.dataset.vote as "up" | "down";
      b.setAttribute("aria-pressed", String(existing === v));
      if (existing) b.disabled = true;
      b.addEventListener("click", () => {
        if (readVote(this.state.mode, slug)) return;
        recordVote(this.state.mode, slug, v);
        for (const bb of el.querySelectorAll<HTMLButtonElement>(".vote-btn")) {
          bb.disabled = true;
          bb.setAttribute("aria-pressed", String(bb === b));
        }
      });
    }
    return el;
  }
}

new App().start().catch((e: unknown) => {
  $("#meta-line").textContent = `데이터를 불러오지 못했습니다: ${e instanceof Error ? e.message : String(e)}`;
});
