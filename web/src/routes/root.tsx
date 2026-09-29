/** Document parts shared by every language (#10): metadata defaults and the pre-paint scripts of app/[locale]/layout.tsx. */
import type { Metadata, Viewport } from "next";
import { LOCALE_REDIRECT_SCRIPT, localizedPath, type Locale } from "@/i18n/locale";
import { messages } from "@/i18n/messages";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

export const rootMetadata = (locale: Locale): Metadata => ({
  metadataBase: new URL("https://hpgg.win"),
  title: { default: messages[locale].site.title, template: "%s | HPGG" },
  description: messages[locale].site.description,
  icons: { icon: "/img/brand/icon-sm.png", apple: "/img/brand/icon.png" },
  openGraph: { siteName: "hpgg.win", locale: messages[locale].lang.og, type: "website", images: ["/img/brand/logo-h.png"] },
});

export const rootViewport: Viewport = { themeColor: "#0e1118", colorScheme: "dark" };

/** In <head>, before anything paints: the stored language hint (i18n/locale.ts), the theme (lib/theme.ts), the font. */
export function HeadScripts({ locale }: { locale: Locale }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: LOCALE_REDIRECT_SCRIPT(locale) }} />
      <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
    </>
  );
}

/** A language's root (/<locale>/): one game so far — forward to its Heroes of the Storm section. */
export function RootRedirect({ locale }: { locale: Locale }) {
  const to = localizedPath("/hots/", locale);
  return (
    <>
      <meta httpEquiv="refresh" content={`0; url=${to}`} />
      <main className="grid min-h-screen place-items-center">
        <a href={to} className="text-primary">
          {messages[locale].site.rootLink}
        </a>
      </main>
    </>
  );
}
