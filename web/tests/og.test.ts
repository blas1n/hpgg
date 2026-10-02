import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { rootMetadata } from "../src/routes/root";
import { LOCALES } from "../src/i18n/locales";

// The link-preview image (Inven, Arca, Discord, KakaoTalk). Until 2026-10-02 it was the 600×171 horizontal logo,
// which a large-image card crops; previews want 1.91:1, 1200×630.
const here = dirname(fileURLToPath(import.meta.url));
const data = join(here, "..", "..", "data");

/** Width and height from a PNG's IHDR chunk. */
function pngSize(path: string): [number, number] {
  const b = readFileSync(path);
  expect(b.subarray(1, 4).toString("ascii")).toBe("PNG");
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

describe("link-preview image", () => {
  for (const locale of LOCALES) {
    it(`${locale}: is a 1200×630 card in that language`, () => {
      const images = rootMetadata(locale).openGraph?.images;
      const src = (Array.isArray(images) ? images[0] : images) as string;
      expect(src).toBe(`/img/brand/og-${locale}.png`);
      expect(pngSize(join(data, src))).toEqual([1200, 630]);
    });
  }
});
