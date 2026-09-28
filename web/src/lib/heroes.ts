/** 영웅 grid filter: role + the header search's matching (Korean, English, 초성), without its result cap. */
import { searchHeroes, type SearchItem } from "./search";

export function filterHeroes<T extends SearchItem>(items: T[], role: string, query: string): T[] {
  const byRole = role === "all" ? items : items.filter((h) => h.role === role);
  return query.trim() ? searchHeroes(byRole, query, Infinity) : byRole;
}
