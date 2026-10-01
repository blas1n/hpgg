import type { ReactNode } from "react";
import { HpCredit } from "./HpCredit";

/** The opening block of a page: the title with the Heroes Profile credit on the same line (API terms §4), and the
 *  page's meta line under them. `aside` is a control that belongs on the title's row (the home page's mode toggle);
 *  the credit then sits between the title and it, still on that line.
 *
 *  Pages whose title is drawn into a banner (map detail) or beside a portrait (hero detail) do not use this; they place
 *  `HpCredit` themselves. Every page is covered either way — `e2e/attribution.spec.ts` checks all of them. */
export function PageHead({ title, aside, children }: { title: string; aside?: ReactNode; children?: ReactNode }) {
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
          <h1 className="text-2xl font-extrabold tracking-tight text-fg">{title}</h1>
          <HpCredit />
        </div>
        {aside}
      </div>
      {children}
    </div>
  );
}
