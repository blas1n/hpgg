import type { Metadata } from "next";
import { messages } from "@/i18n/messages";
import { NotFoundBody } from "@/routes/not-found";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "@/styles/globals.css";

// GitHub Pages serves one 404.html for every missing path, Korean or English, so it speaks both (Korean first).
// Two root layouts (app/(ko), app/(en)) leave no single layout for app/not-found.tsx: this page carries its own document.
export const metadata: Metadata = { title: `404 · ${messages.ko.notFound.title} · ${messages.en.notFound.title}` };

export default function GlobalNotFound() {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <main className="grid min-h-screen place-items-center px-4 text-center">
          <div>
            <p className="text-6xl font-extrabold text-primary">404</p>
            <NotFoundBody locale="ko" />
            <div className="mt-8 border-t border-line pt-6">
              <NotFoundBody locale="en" primary={false} />
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
