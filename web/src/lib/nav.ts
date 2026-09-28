/** Site chrome shared by every page: top brand bar + bottom tab bar (ow-athena style on phones). */

export type PageId = "home" | "heroes" | "maps" | "tier";

const TABS: { id: PageId; href: string; label: string; icon: string }[] = [
  { id: "home", href: "./", label: "홈", icon: "⌂" },
  { id: "heroes", href: "./heroes.html", label: "영웅", icon: "☺" },
  { id: "maps", href: "./maps.html", label: "전장", icon: "▦" },
  { id: "tier", href: "./tier.html", label: "티어표", icon: "≡" },
];

export function mountNav(active: PageId): void {
  const header = document.createElement("header");
  header.className = "top";
  header.innerHTML = `<a class="brand" href="./"><span class="logo">S</span><span class="brand-name">히오스 티어표</span><span class="domain">hotsmeta.kr</span></a>`;
  const nav = document.createElement("nav");
  nav.className = "tabs";
  nav.setAttribute("aria-label", "주 메뉴");
  for (const t of TABS) {
    const a = document.createElement("a");
    a.href = t.href;
    a.dataset.page = t.id;
    a.className = "tab" + (t.id === active ? " active" : "");
    if (t.id === active) a.setAttribute("aria-current", "page");
    a.innerHTML = `<span class="tab-icon" aria-hidden="true">${t.icon}</span><span>${t.label}</span>`;
    nav.appendChild(a);
  }
  document.body.prepend(header);
  document.body.appendChild(nav);
}

export function mountFooter(extra?: string): void {
  const f = document.createElement("footer");
  f.className = "foot";
  f.innerHTML = `${extra ?? ""}<p class="muted">Data provided by <a href="https://www.heroesprofile.com/" rel="noopener">Heroes Profile</a> · 매일 새벽 갱신 · 초상화·전장 이미지 © Blizzard Entertainment (HeroesToolChest 배포본).</p>`;
  document.body.appendChild(f);
}
