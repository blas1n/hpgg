import { en } from "./en";
import { ko, type Messages } from "./ko";
import type { Locale } from "./locale";

export type { Messages };
export const messages: Record<Locale, Messages> = { ko, en };
