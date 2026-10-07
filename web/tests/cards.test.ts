import { describe, expect, it } from "vitest";
import { cardsDocument, type Card } from "../src/lib/cards";

// 카드뉴스 (owner 2026-10-07: "카드 뉴스는 이대로 가져가고"): the weekly report as 1080×1350 cards, one claim and one
// number each, rendered from <week>.analysis.json `cards` by web/scripts/render-cards.mjs.

const cards: Card[] = [
  { type: "cover", section: "HOTS 주간 메타 · 41주", tag: "검토 전 초안", title: "너프 맞은 잘아타스, 그래도 <em>열 판 중 아홉 판</em>은 밴", lede: "이번 주는…", foot: "폭풍 리그 리플레이 1,177판" },
  { type: "stat", section: "중심 픽", big: "92", unit: "%", title: "잘아타스 밴률", lede: "65판에서 첫 픽", foot: "1,177판" },
  { type: "bars", section: "밴 칸", title: "밴 한 칸은 고정", bars: [{ name: "잘아타스", value: 92, hl: true }, { name: "키히라", value: 65 }], foot: "판마다 밴된 비율" },
  { type: "compare", section: "이번 주 변경", title: "너프 뒤", boxes: [{ k: "밴률", from: "94.0", to: "89.3", s: "739판 → 438판", dir: "down" }], note: "공식 노트…", foot: "빌드 98348 전후" },
  { type: "list", section: "관전 포인트", title: "아직 이른 것", items: [{ text: "너프 후 승률", chip: "표본 대기" }], note: "30판 미만은…", foot: "매일 1,500판" },
  { type: "closing", section: "HOTS 주간 메타 · 41주", title: "전체 분석은 <em>hpgg.win</em>에서", lede: "댓글로 알려주세요", foot: "매주 월요일" },
];

describe("cardsDocument", () => {
  const html = cardsDocument(cards);

  it("draws every card at 1080×1350 with its number of the set", () => {
    expect(html.match(/class="card"/g)?.length).toBe(6);
    expect(html).toContain("width:1080px;height:1350px");
    expect(html).toContain("1 / 6");
    expect(html).toContain("6 / 6");
  });

  it("keeps the claim and the number of each card", () => {
    expect(html).toContain("92<small>%</small>");
    expect(html).toContain("<em>열 판 중 아홉 판</em>");
    expect(html).toContain("width:65%");
    expect(html).toContain("94.0");
    expect(html).toContain("표본 대기");
  });

  it("escapes everything but the one <em> a title may carry", () => {
    const h = cardsDocument([{ type: "closing", section: "<script>x</script>", title: "a <b>b</b> <em>c</em>", lede: "", foot: "" }]);
    expect(h).not.toContain("<script>x</script>");
    expect(h).toContain("&lt;b&gt;b&lt;/b&gt; <em>c</em>");
  });
});
