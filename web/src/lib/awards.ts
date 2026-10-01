/** End-of-match awards (MVP, 최후의 보루 …) in the page language: data/awards.json, tools/build_awards.py. */
import type { AwardTable } from "../data";
import { DEFAULT_LOCALE, type Locale } from "../i18n/locale";
import { localField } from "../i18n/names";

export interface AwardView {
  key: string;
  name: string;
  icon: string;
  mvp: boolean;
}

/** An award in the page language, or null (no award, an award the table lacks, or the table not loaded yet). */
export function awardView(key: string | null, awards: AwardTable | null, locale: Locale): AwardView | null {
  const a = key && awards ? awards.awards[key] : undefined;
  if (!a || !key) return null;
  return { key, name: locale === DEFAULT_LOCALE ? a.ko : (localField(a, locale) ?? a.ko), icon: a.icon, mvp: key === "MVP" };
}
