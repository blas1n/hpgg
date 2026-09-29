import type { Metadata } from "next";
import { DEFAULT_LOCALE, LOCALES } from "@/i18n/locale";
import { messages } from "@/i18n/messages";
import { NotFoundBody } from "@/routes/not-found";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "@/styles/globals.css";

// GitHub Pages serves one 404.html for every missing path, whatever its language, so it speaks all of them (the
// default first). The root layout lives in app/[locale], so this page carries its own document.
export const metadata: Metadata = { title: ["404", ...LOCALES.map((l) => messages[l].notFound.title)].join(" · ") };

export default function GlobalNotFound() {
  return (
    <html lang={DEFAULT_LOCALE} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <main className="grid min-h-screen place-items-center px-4 text-center">
          <div>
            <p className="text-6xl font-extrabold text-primary">404</p>
            {LOCALES.map((l, i) => (
              <div key={l} className={i ? "mt-8 border-t border-line pt-6" : undefined}>
                <NotFoundBody locale={l} primary={i === 0} />
              </div>
            ))}
          </div>
        </main>
      </body>
    </html>
  );
}
