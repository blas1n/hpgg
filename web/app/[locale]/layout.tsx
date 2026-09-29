import { localeParams } from "@/i18n/locale";
import { LocaleProvider } from "@/i18n/client";
import { pageLocale, type LocaleProps } from "@/routes/params";
import { HeadScripts, rootMetadata, rootViewport } from "@/routes/root";
import Script from "next/script";
import "@/styles/globals.css";

// Every language from one tree (#10): /<locale>/… for each entry of LOCALES (src/i18n/locales.ts), nothing else.
export const dynamicParams = false;
export const generateStaticParams = localeParams;
export const generateMetadata = async (props: LocaleProps) => rootMetadata(await pageLocale(props));
export const viewport = rootViewport;

export default async function RootLayout(props: LocaleProps & { children: React.ReactNode }) {
  const locale = await pageLocale(props);
  return (
    // the init script sets data-theme before paint (light theme, #1): React must keep what it finds there
    <html lang={locale} suppressHydrationWarning>
      <head>
        <HeadScripts locale={locale} />
      </head>
      <body>
        <LocaleProvider locale={locale}>{props.children}</LocaleProvider>
        <Script data-goatcounter="https://hpgg.goatcounter.com/count" src="https://gc.zgo.at/count.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
