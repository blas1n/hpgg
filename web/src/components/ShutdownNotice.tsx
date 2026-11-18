"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useT } from "@/i18n/client";
import { hideNoticeToday, noticeHidden } from "@/lib/shutdown";

const noop = () => () => {};

/**
 * Service shutdown notice (src/lib/shutdown.ts), opened on every page of the static export. It renders only in the
 * browser: the server snapshot keeps it hidden, so the exported HTML (and crawlers) never carry the overlay.
 */
export function ShutdownNotice() {
  const t = useT();
  const hiddenToday = useSyncExternalStore(noop, () => noticeHidden(() => localStorage, new Date()), () => true);
  const [closed, setClosed] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const open = !hiddenToday && !closed;

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setClosed(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-bg/80 p-4 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && setClosed(true)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shutdown-title"
        className="w-full max-w-md break-keep rounded-xl border border-line-strong bg-surface-2 p-5 shadow-2xl shadow-black/50"
      >
        <h2 id="shutdown-title" className="text-lg font-bold text-fg">
          {t.shutdown.title}
        </h2>
        <div className="mt-3 space-y-2 text-sm leading-relaxed text-muted">
          {t.shutdown.body.map((line, i) => (
            <p key={i} className={i === 0 ? "font-semibold text-fg" : undefined}>
              {line}
            </p>
          ))}
        </div>
        <div className="mt-5 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              hideNoticeToday(() => localStorage, new Date());
              setClosed(true);
            }}
            className="text-sm text-muted underline-offset-2 hover:text-fg hover:underline"
          >
            {t.shutdown.hideToday}
          </button>
          <button
            ref={closeRef}
            type="button"
            onClick={() => setClosed(true)}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-ink transition-opacity hover:opacity-90"
          >
            {t.shutdown.close}
          </button>
        </div>
      </div>
    </div>
  );
}
