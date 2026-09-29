import { en } from "./en";
import { ko, type Messages } from "./ko";
import type { Locale } from "./locales";

export type { Messages };
export const messages: Record<Locale, Messages> = { ko, en };
