import type { Messages } from "@/i18n/messages";

/** 개인정보처리방침 (#28): plain text from the message tables, readable at any width. */
export function PrivacyView({ t }: { t: Messages["privacy"] }) {
  return (
    <main className="page-x mt-6 pb-10">
      <article className="max-w-3xl break-keep">
        <h1 className="text-2xl font-extrabold tracking-tight text-fg">{t.title}</h1>
        <p className="mt-1 text-xs text-muted">{t.effective}</p>
        <p className="mt-4 text-sm leading-relaxed text-fg-2">{t.intro}</p>
        {t.sections.map((s, i) => (
          <section key={s.title} aria-labelledby={`privacy-${i}`} className="mt-7">
            <h2 id={`privacy-${i}`} className="text-base font-bold text-fg">
              {s.title}
            </h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-fg-2 marker:text-muted">
              {s.items.map((item) => (
                <li key={item} className="[overflow-wrap:anywhere]">
                  {item}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </article>
    </main>
  );
}
