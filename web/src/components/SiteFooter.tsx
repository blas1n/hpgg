import { assetUrl, hotsHref } from "@/data";
import type { Locale } from "@/i18n/locale";
import { messages } from "@/i18n/messages";

export function SiteFooter({ locale }: { locale: Locale }) {
  const t = messages[locale].footer;
  const href = hotsHref(locale);
  const cols = [
    {
      title: t.game,
      links: [
        { href: href.tier(), label: t.tier },
        { href: href.tier("mode=sl"), label: t.slTier },
        { href: href.heroes, label: t.heroes },
        { href: href.maps, label: t.maps },
      ],
    },
    {
      title: "HPGG",
      links: [
        { href: "https://github.com/blas1n/hpgg", label: "GitHub" },
        { href: "mailto:contact@hpgg.win", label: t.contact },
        { href: "https://github.com/blas1n/hpgg/issues", label: t.bugs },
        { href: "https://www.heroesprofile.com/", label: t.data },
      ],
    },
  ];
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
          <p className="mt-2 text-[13px] text-fg-2">{t.tagline}</p>
          <p className="mt-1 text-xs text-muted">
            {t.dataBy}{" "}
            <a href="https://www.heroesprofile.com/" rel="noopener" className="text-secondary hover:text-primary">
              Heroes Profile
            </a>{" "}
            · {t.daily}
          </p>
        </div>
        {cols.map((c) => (
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
        <p className="page-x py-5 text-2xs leading-relaxed text-muted">{t.legal}</p>
      </div>
    </footer>
  );
}
