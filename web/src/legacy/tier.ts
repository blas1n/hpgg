import { computeTiers, formulaLine, PRESETS, type Ranked, type Row, type Snapshot } from "../formula";
import { wilson } from "../wilson";
import {
  assetUrl,
  hotsHref,
  BRACKET_LABEL,
  daysSince,
  loadHeroes,
  loadMaps,
  loadMeta,
  loadSnapshot,
  thinSample,
  type HeroInfo,
  type HeroTable,
  type MapTable,
  snapshotKey,
  type Bracket,
  type Meta,
  type Mode,
  type PatchChoice,
} from "../data";

type SortKey = "score" | "win_rate" | "pick" | "ban_rate" | "games";

interface State {
  mode: Mode;
  bracket: Bracket; // Storm League rank bracket (sl_low / sl_mid / sl_high files)
  map: string; // "all" or a map name
  role: string; // "all" or a role name
  patch: PatchChoice;
  sort: SortKey;
  dir: "desc" | "asc";
}

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};

const fmt1 = (n: number) => n.toFixed(1);
const fmtInt = (n: number) => n.toLocaleString("ko-KR");
const SORT_KEYS: SortKey[] = ["score", "win_rate", "pick", "ban_rate", "games"];

function readState(): State {
  const q = new URLSearchParams(location.search);
  const mode: Mode = q.get("mode") === "sl" ? "sl" : "qm";
  const sort = q.get("sort") as SortKey | null;
  const bracket = q.get("tier") as Bracket | null;
  return {
    mode,
    bracket: mode === "sl" && bracket && ["low", "mid", "high"].includes(bracket) ? bracket : "all",
    map: mode === "sl" ? (q.get("map") ?? "all") : "all",
    role: q.get("role") ?? "all",
    patch: q.get("patch") === "previous" ? "previous" : "current",
    sort: sort && SORT_KEYS.includes(sort) ? sort : "score",
    dir: q.get("dir") === "asc" ? "asc" : "desc",
  };
}

function writeState(s: State): void {
  const q = new URLSearchParams();
  if (s.mode !== "qm") q.set("mode", s.mode);
  if (s.mode === "sl" && s.bracket !== "all") q.set("tier", s.bracket);
  if (s.mode === "sl" && s.map !== "all") q.set("map", s.map);
  if (s.role !== "all") q.set("role", s.role);
  if (s.patch === "previous") q.set("patch", "previous");
  if (s.sort !== "score") q.set("sort", s.sort);
  if (s.dir !== "desc") q.set("dir", s.dir);
  const qs = q.toString();
  history.replaceState(null, "", location.pathname + (qs ? `?${qs}` : ""));
}

const ROLE_COLOR: Record<string, string> = {
  Tank: "#4f9cff",
  Bruiser: "#f0883e",
  Healer: "#3fb950",
  Support: "#c297ff",
  "Melee Assassin": "#f85149",
  "Ranged Assassin": "#ffd23f",
};

class App {
  private meta!: Meta;
  private heroes!: HeroTable;
  private maps!: MapTable;
  private byName = new Map<string, HeroInfo>();
  private snapshot: Snapshot | null = null;
  private previous: Snapshot | null = null; // previous patch, same mode (for ▲▼ rank deltas)
  private loadedKey = "";
  private state: State = readState();
  private autoPrevious = false;
  private expanded: string | null = null;

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
    $<HTMLSelectElement>("#bracket").addEventListener("change", (e) => {
      this.state.bracket = (e.target as HTMLSelectElement).value as Bracket;
      this.expanded = null;
      void this.refresh();
    });
    $<HTMLSelectElement>("#map").addEventListener("change", (e) => {
      this.state.map = (e.target as HTMLSelectElement).value;
      this.expanded = null;
      this.render();
    });
    for (const th of document.querySelectorAll<HTMLTableCellElement>("th[data-sort]")) {
      th.querySelector(".sort")?.addEventListener("click", () => {
        const key = th.dataset.sort as SortKey;
        if (this.state.sort === key) this.state.dir = this.state.dir === "desc" ? "asc" : "desc";
        else {
          this.state.sort = key;
          this.state.dir = "desc";
        }
        this.render();
      });
    }
  }

  private setMode(mode: Mode): void {
    if (this.state.mode === mode) return;
    this.state.mode = mode;
    this.state.map = "all";
    this.state.bracket = "all";
    this.state.patch = "current";
    this.expanded = null;
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
    const forced = new URLSearchParams(location.search).get("patch");
    this.autoPrevious = false;
    if (!forced && this.meta.previous_patch && thinSample(this.meta, mode)) {
      this.state.patch = "previous";
      this.autoPrevious = true;
    } else if (this.state.patch === "previous" && !this.meta.previous_patch) {
      this.state.patch = "current";
    }
    const file = snapshotKey(mode, this.state.bracket);
    const key = `${file}:${this.state.patch}`;
    if (this.loadedKey !== key) {
      this.snapshot = await loadSnapshot(file, this.state.patch);
      this.previous = null;
      if (this.state.patch === "current" && this.meta.previous_patch) {
        this.previous = await loadSnapshot(file, "previous").catch(() => null);
      }
      this.loadedKey = key;
    }
    this.render();
  }

  private renderBanner(): void {
    const { mode, patch } = this.state;
    const banner = $("#patch-banner");
    banner.hidden = true;
    banner.textContent = "";
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
    } else if (!this.autoPrevious && this.meta.previous_patch && thinSample(this.meta, mode)) {
      banner.hidden = false;
      banner.textContent = `패치 ${this.meta.current_patch} 후 ${daysSince(this.meta.patch_started_at)}일 — 표본이 아직 적습니다.`;
    }
  }

  private render(): void {
    const { mode, map, role, sort, dir } = this.state;
    const snap = this.snapshot;
    if (!snap) return;
    writeState(this.state);

    $("#mode-qm").setAttribute("aria-pressed", String(mode === "qm"));
    $("#mode-sl").setAttribute("aria-pressed", String(mode === "sl"));
    for (const b of document.querySelectorAll<HTMLButtonElement>("#roles .chip")) {
      b.setAttribute("aria-pressed", String(b.dataset.role === role));
    }
    $("#map-wrap").hidden = mode !== "sl";
    $("#bracket-wrap").hidden = mode !== "sl";
    $<HTMLSelectElement>("#map").value = map;
    $<HTMLSelectElement>("#bracket").value = this.state.bracket;
    this.renderBanner();

    const hasBans = mode === "sl";
    const table = $("#table");
    table.classList.toggle("hide-ban", !hasBans);
    for (const th of document.querySelectorAll<HTMLTableCellElement>("th[data-sort]")) {
      if (th.dataset.sort === sort) th.setAttribute("aria-sort", dir === "desc" ? "descending" : "ascending");
      else th.removeAttribute("aria-sort");
    }

    const rows: Row[] = snap.rows.filter((r) => r.map === map);
    const tiers = computeTiers(rows, PRESETS.aichi, this.meta.min_games_for_tier);
    // rank in the previous patch (same mode/map) → ▲▼ next to the rank
    const prevRank = new Map<string, number>();
    if (this.previous) {
      const prevTiers = computeTiers(this.previous.rows.filter((r) => r.map === map), PRESETS.aichi, this.meta.min_games_for_tier);
      for (const x of prevTiers.ranked) prevRank.set(x.row.hero, x.rank);
    }
    this.renderMapHero(map);

    const mapKo = map === "all" ? "전체 전장" : (this.maps.maps.find((m) => m.name === map)?.ko ?? map);
    const matches = map === "all" ? snap.matches : Math.round(rows.reduce((a, r) => a + r.games, 0) / 10);
    const bracketKo = mode === "sl" && this.state.bracket !== "all" ? ` · ${BRACKET_LABEL[this.state.bracket]}` : "";
    $("#meta-line").textContent = `${mode === "qm" ? "빠른 대전" : "폭풍 리그"}${bracketKo} · ${mapKo} · 패치 ${snap.patch} · ${fmtInt(matches)} 매치 · ${snap.collected_at.slice(5, 10).replace("-", "/")} 갱신`;

    // sort the ranked rows for display; tier/rank stay from the score order
    const visible = tiers.ranked.filter((x) => this.roleOk(x.row.hero, role));
    const val = (x: Ranked): number => (sort === "score" ? x.score : x.row[sort]);
    visible.sort((a, b) => (dir === "desc" ? val(b) - val(a) : val(a) - val(b)) || a.rank - b.rank);
    // bar scales: score/pick/ban from 0 to the column max; win rate over the view's min..max
    // range so 48% vs 56% reads as a real gap instead of two nearly full bars
    const wrs = tiers.ranked.map((x) => x.row.win_rate);
    const maxAbs = {
      score: Math.max(1, ...tiers.ranked.map((x) => Math.abs(x.score))),
      win_rate: Math.max(...wrs, 1),
      pick: Math.max(...tiers.ranked.map((x) => x.row.pick), 1),
      ban_rate: Math.max(...tiers.ranked.map((x) => x.row.ban_rate), 1),
      games: Math.max(...tiers.ranked.map((x) => x.row.games), 1),
    };
    const wrMin = Math.min(...wrs, 50);
    const wrSpan = Math.max(maxAbs.win_rate - wrMin, 1);
    const wrRatio = (wr: number) => (wr - wrMin) / wrSpan;

    const body = $("#rows");
    body.innerHTML = "";
    const tplRow = $<HTMLTemplateElement>("#tpl-row");
    const tplDetail = $<HTMLTemplateElement>("#tpl-detail");
    for (const x of visible) body.append(...this.heroRows(tplRow, tplDetail, x, hasBans, tiers.ranked.length, maxAbs, wrRatio, prevRank));

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
표의 막대는 그 열의 최댓값 대비 길이. 승률 ± 는 Wilson 95% 구간. 전장을 고르면 그 전장의 표본으로만 계산합니다.
같은 데이터라도 공식이 다르면 티어가 다릅니다 — 이 사이트는 공식을 숨기지 않습니다.</pre>`;
  }

  private renderMapHero(map: string): void {
    const box = $("#map-hero");
    const m = map === "all" ? undefined : this.maps.maps.find((x) => x.name === map);
    if (!m) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    box.hidden = false;
    box.innerHTML = `<img alt="" src="${m.image ? assetUrl(m.image) : ""}" /><div class="map-hero-text"><h1>${m.ko}</h1><span class="muted">${m.name} · 폭풍 리그 · 이 전장 표본으로만 계산</span></div>`;
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

  private heroRows(
    tplRow: HTMLTemplateElement,
    tplDetail: HTMLTemplateElement,
    x: Ranked,
    hasBans: boolean,
    n: number,
    maxAbs: Record<SortKey, number>,
    wrRatio: (wr: number) => number,
    prevRank: Map<string, number>,
  ): [HTMLTableRowElement, HTMLTableRowElement] {
    const r = x.row;
    const slug = this.slug(r.hero);
    const info = this.byName.get(r.hero);
    const tr = (tplRow.content.firstElementChild as HTMLTableRowElement).cloneNode(true) as HTMLTableRowElement;
    tr.dataset.hero = slug;
    tr.dataset.tier = x.tier;
    const badge = tr.querySelector<HTMLElement>(".badge")!;
    badge.textContent = x.tier;
    badge.classList.add(`badge-${x.tier}`);
    tr.querySelector(".rank")!.textContent = `${x.rank}`;
    tr.querySelector("td.games .v")!.textContent = fmtInt(r.games);
    const deltaEl = tr.querySelector<HTMLElement>(".delta")!;
    if (prevRank.size) {
      const pr = prevRank.get(r.hero);
      const d = pr === undefined ? null : pr - x.rank;
      deltaEl.textContent = d === null ? "NEW" : d === 0 ? "— 0" : d > 0 ? `▲ ${d}` : `▼ ${-d}`;
      deltaEl.className = "delta " + (d === null ? "new" : d > 0 ? "up" : d < 0 ? "down" : "same");
      deltaEl.title = pr === undefined ? "직전 패치엔 표본 부족" : `직전 패치 #${pr}`;
    } else deltaEl.textContent = "";
    const av = tr.querySelector<HTMLElement>(".avatar")!;
    av.style.borderColor = ROLE_COLOR[info?.role ?? ""] ?? "";
    av.title = info?.role_ko ?? "";
    if (info?.portrait) {
      const img = document.createElement("img");
      img.src = assetUrl(info.portrait);
      img.alt = "";
      img.loading = "lazy";
      img.width = 36;
      img.height = 36;
      av.appendChild(img);
    } else {
      av.append(this.ko(r.hero).slice(0, 1));
    }
    tr.querySelector(".name")!.textContent = this.ko(r.hero);
    tr.querySelector(".en")!.textContent = `${r.hero}${info ? ` · ${info.role_ko}` : ""}`;

    const setCell = (cls: string, text: string, ratio: number) => {
      const td = tr.querySelector<HTMLElement>(`td.${cls}`)!;
      td.querySelector(".v")!.textContent = text;
      td.querySelector<HTMLElement>(".bar i")!.style.width = `${Math.max(0, Math.min(100, ratio * 100))}%`;
    };
    setCell("score", (x.score >= 0 ? "+" : "") + x.score.toFixed(0), Math.abs(x.score) / maxAbs.score);
    tr.querySelector("td.score")!.classList.toggle("neg", x.score < 0);
    setCell("wr", `${fmt1(r.win_rate)}%`, wrRatio(r.win_rate));
    setCell("pick", `${fmt1(r.pick)}%`, r.pick / maxAbs.pick);
    setCell("ban", hasBans ? `${fmt1(r.ban_rate)}%` : "", hasBans ? r.ban_rate / maxAbs.ban_rate : 0);

    const detail = (tplDetail.content.firstElementChild as HTMLTableRowElement).cloneNode(true) as HTMLTableRowElement;
    detail.dataset.hero = slug;
    const [lo, hi] = wilson(r.wins, r.games);
    detail.querySelector(".d-rank")!.textContent = `${x.rank} / ${n}`;
    detail.querySelector(".d-wr")!.textContent = `${fmt1(r.win_rate)}% ±${fmt1((hi - lo) / 2)}`;
    detail.querySelector(".d-games")!.textContent = `${fmtInt(r.games)}게임`;
    detail.querySelector(".d-pick")!.textContent = `${fmt1(r.pick)}%`;
    const banRow = detail.querySelector<HTMLElement>(".ban-row")!;
    if (hasBans) detail.querySelector(".d-ban")!.textContent = `${fmt1(r.ban_rate)}%`;
    else banRow.hidden = true;
    detail.querySelector(".d-score")!.textContent = x.score.toFixed(1);
    detail.querySelector<HTMLAnchorElement>(".d-link")!.href = hotsHref.hero(slug);

    const open = this.expanded === slug;
    tr.setAttribute("aria-expanded", String(open));
    detail.hidden = !open;
    const toggle = () => {
      const now = detail.hidden;
      for (const d of document.querySelectorAll<HTMLTableRowElement>("tr.detail-row")) d.hidden = true;
      for (const h of document.querySelectorAll<HTMLTableRowElement>("tr.hero")) h.setAttribute("aria-expanded", "false");
      detail.hidden = !now;
      tr.setAttribute("aria-expanded", String(now));
      this.expanded = now ? slug : null;
    };
    tr.addEventListener("click", toggle);
    tr.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });
    return [tr, detail];
  }
}

/** Mounted by the page component once its markup is in the DOM. */
export function run(): void {
  new App().start().catch((e: unknown) => {
    $("#meta-line").textContent = `데이터를 불러오지 못했습니다: ${e instanceof Error ? e.message : String(e)}`;
  });
}
