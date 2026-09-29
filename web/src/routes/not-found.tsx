import { hotsHref } from "@/data";
import type { Locale } from "@/i18n/locale";
import { messages } from "@/i18n/messages";

/** The 404 body in one language; `id` keeps ids unique when several languages share a page. */
export function NotFoundBody({ locale, primary = true }: { locale: Locale; primary?: boolean }) {
  const t = messages[locale].notFound;
  const href = hotsHref(locale);
  return (
    <div lang={locale}>
      <h1 id={primary ? "meta-line" : undefined} className="mt-3 text-lg font-bold">
        {t.title}
      </h1>
      <p className="mt-1 text-sm text-muted">{t.body}</p>
      <div className="mt-6 flex justify-center gap-2">
        <a href={href.home} className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-ink">
          {t.home}
        </a>
        <a href={href.heroes} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-fg-2">
          {t.heroes}
        </a>
      </div>
    </div>
  );
}
