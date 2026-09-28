/** Site chrome: lol.ps-style top bar (logo + primary nav) and a compact footer. */

export type PageId = "home" | "heroes" | "maps" | "tier";

const NAV: { id: PageId; href: string; label: string }[] = [
  { id: "tier", href: "./tier.html", label: "영웅 티어" },
  { id: "heroes", href: "./heroes.html", label: "영웅" },
  { id: "maps", href: "./maps.html", label: "전장" },
];

export function mountNav(active: PageId): void {
  const bar = document.createElement("header");
  bar.className = "topbar";
  bar.innerHTML = `
    <div class="topbar-in">
      <a class="brand" href="./" aria-label="hotsmeta.kr 홈"><span class="logo">S</span><span class="brand-name">HOTS<span class="brand-accent">META</span></span></a>
      <nav class="tabs" aria-label="주 메뉴"></nav>
      <div class="topbar-right"><a class="topbar-link" href="https://github.com/blas1n/hotsmeta" rel="noopener">GitHub</a></div>
    </div>`;
  const nav = bar.querySelector("nav")!;
  const home = document.createElement("a");
  home.href = "./";
  home.dataset.page = "home";
  home.className = "tab" + (active === "home" ? " active" : "");
  home.textContent = "홈";
  if (active === "home") home.setAttribute("aria-current", "page");
  nav.appendChild(home);
  for (const t of NAV) {
    const a = document.createElement("a");
    a.href = t.href;
    a.dataset.page = t.id;
    a.className = "tab" + (t.id === active ? " active" : "");
    if (t.id === active) a.setAttribute("aria-current", "page");
    a.textContent = t.label;
    nav.appendChild(a);
  }
  document.body.prepend(bar);
}

export function mountFooter(extra?: string): void {
  const f = document.createElement("footer");
  f.className = "foot";
  f.innerHTML = `<div class="foot-in">${extra ?? ""}<p class="muted">Data provided by <a href="https://www.heroesprofile.com/" rel="noopener">Heroes Profile</a> · 매일 새벽 갱신 · 초상화·전장·특성 이미지 © Blizzard Entertainment (HeroesToolChest 배포본) · Heroes of the Storm™ is a trademark of Blizzard Entertainment, Inc. hotsmeta.kr is not affiliated with Blizzard.</p></div>`;
  document.body.appendChild(f);
}

/** Page title band under the top bar: title + right-aligned meta line, lol.ps style. */
export function mountTitle(title: string, metaId = "meta-line"): void {
  const band = document.createElement("div");
  band.className = "title-band";
  band.innerHTML = `<div class="title-in"><h1 class="page-title">${title}</h1><p class="meta" id="${metaId}">불러오는 중…</p></div>`;
  const main = document.querySelector("main");
  main?.parentNode?.insertBefore(band, main);
}
