/** Heroes Profile's embeddable replay uploader (https://www.heroesprofile.com/Upload/Widget). Heroes Profile offered it
 *  in place of CORS on its upload routes (mail to the owner, 2026-09-29): replays go from the visitor's browser straight
 *  to Heroes Profile under the visitor's own IP, recorded under our source name. We never call the upload or
 *  fingerprint routes ourselves, and never relay uploads through our server (both asked by Heroes Profile). */
export const HP_ORIGIN = "https://www.heroesprofile.com";
export const HP_EMBED_URL = `${HP_ORIGIN}/Upload/Embed?source=hpgg`;

export type HpMessage =
  | { type: "resize"; height: number }
  | { type: "complete"; uploaded: number; duplicates: number; failed: number };

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A message from the widget, or null when it is not one: another origin (anyone can post to our window), another
 *  type, or malformed fields. Only the height and the end of the queue are read; `duplicates` are games already on
 *  Heroes Profile, so they count as found. */
export function readHpMessage(event: { origin: string; data: unknown }): HpMessage | null {
  if (event.origin !== HP_ORIGIN || typeof event.data !== "object" || event.data === null) return null;
  const d = event.data as Record<string, unknown>;
  switch (d.type) {
    case "heroesprofile:resize":
      return num(d.height) ? { type: "resize", height: d.height } : null;
    case "heroesprofile:upload-complete":
      return num(d.uploaded) && num(d.duplicates) && num(d.failed) ? { type: "complete", uploaded: d.uploaded, duplicates: d.duplicates, failed: d.failed } : null;
    default:
      return null;
  }
}
