"use client";

import { PageHead } from "@/components/PageHead";
import { shortDate } from "@/data";
import { useT } from "@/i18n/client";
import type { MapCard } from "@/lib/home";
import { MapCardLink } from "../MapCardLink";

/** 전장 — every map in the pool, most Storm League matches first (computed at build time). */
export function MapsView({ cards, patch, matches, collectedAt, fallbackFrom }: { cards: MapCard[]; patch: string; matches: number; collectedAt: string; fallbackFrom: string | null }) {
  const t = useT();
  return (
    <main className="page-x mt-6 space-y-4 pb-10">
      <PageHead title={t.maps.title}>
        <p id="meta-line" className="num mt-0.5 text-xs text-muted">
          {t.common.modes.sl} · {t.common.patch(patch)} · {t.common.matches(matches.toLocaleString("ko-KR"))} · {t.common.updated(shortDate(collectedAt))} · {t.maps.metaTail}
          {fallbackFrom && <span data-fallback> · {t.common.fallbackNote(fallbackFrom)}</span>}
        </p>
      </PageHead>
      <div id="map-grid" className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3">
        {cards.map((c) => (
          <MapCardLink key={c.slug} c={c} />
        ))}
      </div>
    </main>
  );
}
