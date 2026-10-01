import { describe, expect, it } from "vitest";
import { HP_EMBED_URL, HP_ORIGIN, readHpMessage } from "../src/lib/hpUpload";

// Heroes Profile's embeddable uploader (https://www.heroesprofile.com/Upload/Widget, owner's mail from HP 2026-09-29):
// replays go from the visitor's browser straight to HP; the widget posts its results to our page.
describe("Heroes Profile upload widget", () => {
  it("is the embed with our source name (lowercase, recorded with every upload)", () => {
    expect(HP_EMBED_URL).toBe("https://www.heroesprofile.com/Upload/Embed?source=hpgg");
    expect(HP_ORIGIN).toBe("https://www.heroesprofile.com");
  });
  it("trusts a message only from Heroes Profile's origin", () => {
    const data = { type: "heroesprofile:resize", height: 640 };
    expect(readHpMessage({ origin: HP_ORIGIN, data })).toEqual({ type: "resize", height: 640 });
    expect(readHpMessage({ origin: "https://hpgg.win", data })).toBeNull();
    expect(readHpMessage({ origin: "https://heroesprofile.com", data })).toBeNull();
  });
  it("reads the end of the queue; per-replay messages are not used", () => {
    expect(readHpMessage({ origin: HP_ORIGIN, data: { type: "heroesprofile:upload", file: "a", status: "Success", replayID: 7 } })).toBeNull();
    expect(readHpMessage({ origin: HP_ORIGIN, data: { type: "heroesprofile:upload-complete", uploaded: 3, duplicates: 2, failed: 1 } })).toEqual({
      type: "complete",
      uploaded: 3,
      duplicates: 2,
      failed: 1,
    });
  });
  it("ignores anything else, including malformed fields", () => {
    for (const data of [null, "x", { type: "other" }, { type: "heroesprofile:resize", height: "9" }, { type: "heroesprofile:upload-complete", uploaded: 1 }]) {
      expect(readHpMessage({ origin: HP_ORIGIN, data })).toBeNull();
    }
  });
});
