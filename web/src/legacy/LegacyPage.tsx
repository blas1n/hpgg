"use client";

import { useEffect, useRef } from "react";

type Page = "maps";

const loaders: Record<Page, () => Promise<{ run: (slug: string) => void }>> = {
  maps: () => import("./maps"),
};

/** Server-rendered skeleton + the old imperative page module, run once after hydration. */
export function LegacyPage({ page, html, slug = "" }: { page: Page; html: string; slug?: string }) {
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return; // StrictMode re-runs effects in development
    started.current = true;
    void loaders[page]().then((m) => m.run(slug));
  }, [page, slug]);
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
