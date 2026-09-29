/** Route params of app/[locale]/…: the language always comes from the URL (one route tree for every language). */
import { notFound } from "next/navigation";
import { isLocale, type Locale } from "@/i18n/locale";

export type LocaleProps = { params: Promise<{ locale: string }> };
export type SlugProps = { params: Promise<{ locale: string; slug: string }> };

/** The page's language; anything outside LOCALES is a 404 (dynamicParams = false already refuses it at build time). */
export async function pageLocale({ params }: { params: Promise<{ locale: string }> }): Promise<Locale> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return locale;
}
