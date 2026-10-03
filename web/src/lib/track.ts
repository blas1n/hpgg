/** A named event for GoatCounter (the page-view counter already on every page): only fixed names, never a BattleTag
 *  or anything about the visitor. Silent when the counter is blocked or not loaded yet — it never breaks a page. */
type GoatCounter = { count: (v: { path: string; title: string; event: true }) => void };

export function track(name: "upload-cta" | "upload-complete"): void {
  try {
    const g = (globalThis as { window?: { goatcounter?: GoatCounter } }).window?.goatcounter;
    g?.count({ path: name, title: name, event: true });
  } catch {
    // counting is never worth an error on the page
  }
}
