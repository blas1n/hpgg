import { assetUrl, hotsHref } from "@/data";
import type { MapCard } from "@/lib/home";
import { Portrait } from "./ui";

const int = (n: number) => n.toLocaleString("ko-KR");

/** One map: image, Storm League match count, top 3 heroes; opens that map's tier table. Used by 홈 and 전장. */
export function MapCardLink({ c }: { c: MapCard }) {
  return (
    <a
      href={hotsHref.tier(new URLSearchParams({ mode: "sl", map: c.name }))}
      data-map={c.slug}
      data-card="map"
      className="group relative block overflow-hidden rounded-lg border border-line bg-surface-2 transition-colors hover:border-primary"
    >
      <span className="relative block aspect-[4/3] overflow-hidden sm:aspect-[16/7]">
        {c.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={assetUrl(c.image)} alt="" loading="lazy" className="size-full object-cover transition-transform duration-300 group-hover:scale-105" />
        )}
        <span className="absolute inset-0 bg-gradient-to-t from-surface-2 via-surface-2/30 to-transparent" />
        <span className="absolute bottom-2 left-3">
          <span className="block text-sm font-bold text-white drop-shadow sm:text-base">{c.ko}</span>
          <span className="num block text-2xs text-fg-2">{c.matches ? `${int(c.matches)} 매치` : "표본 없음"}</span>
        </span>
      </span>
      <span className="flex min-h-11 items-center gap-2 px-3 py-2.5">
        <span className="hidden text-2xs font-semibold text-muted sm:inline">{c.top.length ? "상위 영웅" : c.name}</span>
        <span className="flex gap-2 sm:ml-auto">
          {c.top.map((t) => (
            <span key={t.hero.slug} title={t.hero.ko} data-top-hero={t.hero.slug}>
              <Portrait src={t.hero.portrait} size={28} tier={t.tier} />
            </span>
          ))}
        </span>
      </span>
    </a>
  );
}
