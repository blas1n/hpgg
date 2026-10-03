"use client";

import { useT } from "@/i18n/client";
import type { ChangeGroup } from "@/lib/patchnotes";
import { cx } from "../ui";

/** Changed lines under their heading (기본 · 7레벨 · ability), ▲ buff / ▼ nerf / · not judged — the hero page's patch
 *  notes and the patch summary show them the same way. */
export function ChangeGroups<G extends ChangeGroup>({ groups, label }: { groups: G[]; label?: (g: G, i: number) => string | null }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1.5">
      {groups.map((g, i) => (
        <div key={i}>
          <div className="text-2xs text-muted">
            {[label?.(g, i), t.hero.patchSection[g.section], g.level !== null && t.hero.patchLevel(String(g.level)), g.ability].filter(Boolean).join(" · ")}
          </div>
          <ul className="mt-0.5 flex flex-col gap-0.5">
            {g.changes.map((c, j) => (
              <li key={j} data-change={c.direction} className="grid grid-cols-[14px_1fr] gap-1 text-[13px] leading-snug text-fg-2">
                <span aria-hidden className={cx("text-center text-2xs leading-5", c.direction === "up" ? "text-pos" : c.direction === "down" ? "text-neg" : "text-muted")}>
                  {c.direction === "up" ? "▲" : c.direction === "down" ? "▼" : "·"}
                </span>
                <span>{c.text}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
