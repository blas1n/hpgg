/** The HTML document, once per language (#10): <html lang>, metadata defaults, the pre-paint scripts. */
import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { LocaleProvider } from "@/i18n/client";
import { LOCALE_REDIRECT_SCRIPT, localizedPath, OG_LOCALE, type Locale } from "@/i18n/locale";
import { messages } from "@/i18n/messages";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "@/styles/globals.css";

export const rootMetadata = (locale: Locale): Metadata => ({
  metadataBase: new URL("https://hpgg.win"),
  title: { default: messages[locale].site.title, template: "%s | HPGG" },
  description: messages[locale].site.description,
  icons: { icon: "/img/brand/icon-sm.png", apple: "/img/brand/icon.png" },
  openGraph: { siteName: "hpgg.win", locale: OG_LOCALE[locale], type: "website", images: ["/img/brand/logo-h.png"] },
});

export const rootViewport: Viewport = { themeColor: "#0e1118", colorScheme: "dark" };

export function RootDocument({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return (
    // the init script sets data-theme before paint (light theme, #1): React must keep what it finds there
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/* a visitor who chose the other language goes to this page in it before anything paints (i18n/locale.ts) */}
        <script dangerouslySetInnerHTML={{ __html: LOCALE_REDIRECT_SCRIPT(locale) }} />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body>
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
        <Script data-goatcounter="https://hpgg.goatcounter.com/count" src="https://gc.zgo.at/count.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}

/** A language's root (/ or /en/): one game so far — forward to its Heroes of the Storm section. */
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
