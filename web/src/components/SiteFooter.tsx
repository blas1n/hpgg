import { assetUrl, hotsHref } from "@/data";

const COLS = [
  {
    title: "히어로즈 오브 더 스톰",
    links: [
      { href: hotsHref.tier(), label: "영웅 티어" },
      { href: hotsHref.tier("mode=sl"), label: "폭풍 리그 티어" },
      { href: hotsHref.heroes, label: "영웅" },
      { href: hotsHref.maps, label: "전장" },
    ],
  },
  {
    title: "HPGG",
    links: [
      { href: "https://github.com/blas1n/hpgg", label: "GitHub" },
      { href: "mailto:contact@hpgg.win", label: "문의 · contact@hpgg.win" },
      { href: "https://github.com/blas1n/hpgg/issues", label: "버그 제보 (GitHub)" },
      { href: "https://www.heroesprofile.com/", label: "데이터: Heroes Profile" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line bg-canvas">
      <div className="page-x grid gap-8 py-10 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={assetUrl("img/brand/icon-sm.png")} alt="" width={24} height={24} className="size-6 rounded" />
            <span className="text-lg font-extrabold tracking-tight text-fg">
              hpgg<span className="text-xs font-semibold text-primary">.win</span>
            </span>
          </div>
          <p className="mt-2 text-[13px] text-fg-2">Happy Good Game — 매치 데이터로 보는 메타 통계. 공식을 숨기지 않습니다.</p>
          <p className="mt-1 text-xs text-muted">
            Data provided by{" "}
            <a href="https://www.heroesprofile.com/" rel="noopener" className="text-secondary hover:text-primary">
              Heroes Profile
            </a>{" "}
            · 매일 새벽 갱신
          </p>
        </div>
        {COLS.map((c) => (
          <nav key={c.title} aria-label={c.title}>
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted">{c.title}</h2>
            <ul className="mt-3 space-y-2">
              {c.links.map((l) => (
                <li key={l.href}>
                  <a href={l.href} className="text-[13px] text-fg-2 transition-colors hover:text-primary" rel={l.href.startsWith("http") ? "noopener" : undefined}>
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-line">
        <p className="page-x py-5 text-2xs leading-relaxed text-muted">
          초상화·전장·특성 이미지 © Blizzard Entertainment (HeroesToolChest 배포본). Heroes of the Storm™ is a trademark of Blizzard Entertainment, Inc. hpgg.win
          (Happy Good Game) is not affiliated with or endorsed by Blizzard Entertainment.
        </p>
      </div>
    </footer>
  );
}
