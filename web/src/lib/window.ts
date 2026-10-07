/** Which games the stats count (owner 2026-10-07): a settled balance hotfix starts the count (collector/snapshot.py
 *  balance_window, meta.window); a newer one still settling leaves the whole patch, said as pending. Pure. */

export interface MetaWindow {
  since: string | null;
  since_at: string | null;
  pending: { build: string; first_seen: string } | null;
}

export interface WindowNote {
  kind: "since" | "pending";
  /** the day the build arrived, Korean time (M/D) */
  day: string;
  build: string;
}

const kstDay = (iso: string): string => {
  const d = new Date(Date.parse(iso) + 9 * 3600 * 1000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};

export function windowNote(meta: { current_patch?: string; window?: MetaWindow }): WindowNote | null {
  const w = meta.window;
  if (!w) return null;
  if (w.pending) return { kind: "pending", day: kstDay(w.pending.first_seen), build: w.pending.build };
  if (w.since && w.since_at) return { kind: "since", day: kstDay(w.since_at), build: w.since };
  return null;
}
