/** 영웅 grid filter: role + universe + the header search's matching (Korean, English, 초성), without its result cap. */
import { searchHeroes, type SearchItem } from "./search";

export function filterHeroes<T extends SearchItem & { franchise?: string }>(items: T[], role: string, query: string, universe = "all"): T[] {
  const kept = items.filter((h) => (role === "all" || h.role === role) && (universe === "all" || h.franchise === universe));
  return query.trim() ? searchHeroes(kept, query, Infinity) : kept;
}
