/** Hero search for the header box: Korean, English (accent/punctuation-insensitive) and 초성 queries. */

export interface SearchItem {
  slug: string;
  ko: string;
  name: string;
  role: string;
  role_ko: string;
  portrait?: string;
  tier?: string;
  /** The name in the other language (English pages keep Korean names searchable). */
  alt?: string;
}

/** The 19 initial consonants (ㄱ ㄲ ㄴ … ㅎ) in syllable order, as compatibility jamo — what people type. */
const CHO = "\u3131\u3132\u3134\u3137\u3138\u3139\u3141\u3142\u3143\u3145\u3146\u3147\u3148\u3149\u314a\u314b\u314c\u314d\u314e";
const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;

/** 일리단 → ㅇㄹㄷ. Non-syllable characters pass through unchanged. */
export function chosung(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    out += c >= HANGUL_START && c <= HANGUL_END ? CHO[Math.floor((c - HANGUL_START) / 588)] : ch;
  }
  return out;
}

const isChosungOnly = (q: string): boolean => [...q].every((ch) => CHO.includes(ch));
/** Lower-case, strip accents, spaces and punctuation: "Li-Ming" → "liming", "Lúcio" → "lucio". */
const fold = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

/** 0 exact · 1 prefix · 2 substring · -1 no match. */
function matchRank(hay: string, q: string): number {
  if (!q || !hay) return -1;
  if (hay === q) return 0;
  if (hay.startsWith(q)) return 1;
  return hay.includes(q) ? 2 : -1;
}

export function searchHeroes<T extends SearchItem>(items: T[], query: string, limit = 8): T[] {
  const q = fold(query);
  if (!q) return [];
  const cho = isChosungOnly(q);
  const scored: { item: T; score: number; i: number }[] = [];
  items.forEach((item, i) => {
    const ranks = cho
      ? [matchRank(fold(chosung(item.alt ?? item.ko)), q)]
      : [matchRank(fold(item.ko), q), matchRank(fold(item.name), q), matchRank(item.slug.replace(/-/g, ""), q), item.alt ? matchRank(fold(item.alt), q) : -1];
    const hits = ranks.filter((r) => r >= 0);
    if (hits.length) scored.push({ item, score: Math.min(...hits), i });
  });
  scored.sort((a, b) => a.score - b.score || a.i - b.i);
  return scored.slice(0, limit).map((s) => s.item);
}
