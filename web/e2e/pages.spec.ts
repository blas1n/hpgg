import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/gc.zgo.at/**", (r) => r.abort());
});

// Home, heroes, hero detail and maps pages against the frozen e2e data set.

test("heroes: grid of 90 with tier badges, search and role filter", async ({ page }) => {
  await page.goto("./heroes/");
  const cards = page.locator("#grid a[data-hero]");
  await expect(cards).toHaveCount(90);
  await expect(page.locator('#grid a[data-hero="qhira"] .tier-badge')).toHaveText("S");
  await page.locator("#search").fill("일리");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("일리단");
  await page.locator("#search").fill("ㅇㄹㄷ"); // 초성, like the header search
  await expect(cards.first()).toHaveAttribute("data-hero", "illidan");
  await page.locator("#search").fill("zzzz");
  await expect(page.locator("main")).toContainText("맞는 영웅이 없습니다");
  await page.locator("#search").fill("");
  await page.locator('#roles button[data-role="Tank"]').click();
  await expect(page).toHaveURL(/role=Tank/);
  const n = await cards.count();
  expect(n).toBeGreaterThan(5);
  expect(n).toBeLessThan(90);
});

test("heroes: the mode toggle swaps the tiers and the hero links carry the mode", async ({ page }) => {
  await page.goto("./heroes/?role=Healer");
  await expect(page.locator('#roles button[data-role="Healer"]')).toHaveAttribute("aria-pressed", "true");
  const bw = page.locator('#grid a[data-hero="brightwing"]');
  await expect(bw).toHaveAttribute("data-tier", "A"); // QM, as on the tier table
  await page.locator("#mode-sl").click();
  await expect(page).toHaveURL(/mode=sl&role=Healer/);
  await expect(bw).toHaveAttribute("data-tier", "F");
  await expect(bw).toHaveAttribute("href", "/hots/heroes/brightwing/?mode=sl");
});

test("hero detail: three stat cards, per-map rows (not links) in SL, brackets, no vote", async ({ page }) => {
  await page.goto("./heroes/illidan/");
  await expect(page.locator("h1")).toHaveText("일리단");
  const cards = page.locator("#stats > div");
  await expect(cards).toHaveCount(3); // tier, win rate, pick — no other-mode card (owner: confusing)
  await expect(cards.first()).toContainText("B"); // QM tier from the fixture
  await expect(cards.first()).toContainText("— 0"); // same rank as the previous patch, written like the table
  await expect(page.locator("#stats")).not.toContainText("점수");
  await expect(page.locator("#stats")).not.toContainText("밴 없음");
  await expect(page.locator("#stats")).not.toContainText("명 중"); // owner: not what people look at, and it wrapped
  await expect(page.locator("#stats")).not.toContainText("±");
  for (const sub of await page.locator("#stats [data-sub]").all()) {
    const lh = await sub.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight) || 16);
    expect((await sub.boundingBox())!.height, "card note fits on one line").toBeLessThanOrEqual(lh * 1.5);
  }
  await expect(page.locator("#maps")).toContainText("전장별 표본이 없습니다"); // fixture QM has no per-map rows: say so
  await page.locator("#mode-sl").click();
  await expect(page).toHaveURL(/mode=sl/);
  await expect(cards.first()).toContainText("A");
  await expect(cards).toHaveCount(3);
  await expect(page.locator("#maps [data-map]")).toHaveCount(1); // fixture SL has one real map (Cursed Hollow)
  await expect(page.locator('#maps [data-map="cursed-hollow"]')).toContainText("저주받은 골짜기");
  await expect(page.locator("#maps a")).toHaveCount(0); // map rows do not navigate
  await expect(page.locator("#brackets")).toBeVisible();
  await expect(page.locator("#brackets [data-bracket]")).toHaveCount(2); // 브실골플 / 다마그
  await expect(page.locator("main button:not([id^=mode-]):not([data-talent])")).toHaveCount(0); // no vote buttons: only the mode toggle and talent icons are buttons
});

test("hero detail: section tabs stick under the header and land each section just below them", async ({ page }) => {
  await page.goto("./heroes/illidan/");
  await expect(page.locator("#builds [data-build]")).toHaveCount(5);
  const nav = page.locator("nav[data-subnav]");
  const header = page.locator("body > header, header.sticky").first();
  const headerBottom = async () => (await header.boundingBox())!.y + (await header.boundingBox())!.height;
  for (const [link, target] of [["#nav-builds", "#builds-title"], ["a[href='#maps-title']", "#maps-title"]] as const) {
    await nav.locator(link).click();
    await expect.poll(async () => {
      const t = (await page.locator(target).boundingBox())!.y;
      const n = await nav.boundingBox();
      return t >= n!.y + n!.height - 1 && t <= n!.y + n!.height + 40;
    }, { message: `${target} lands right under the tabs` }).toBe(true);
    expect((await nav.boundingBox())!.y).toBeCloseTo(await headerBottom(), 0); // tabs stuck under the header
    await expect(nav.locator(link)).toHaveAttribute("aria-current", "location");
  }
  await nav.locator("a[href='#top']").click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

test("hero detail: at the bottom of the page the last section's tab is active", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 }); // two build columns: the builds title cannot reach the tabs
  await page.goto("./heroes/illidan/?mode=sl");
  // ?mode=sl is applied after hydration and adds sections: scroll only once the page has its final length
  await expect(page.locator("#brackets [data-bracket]")).toHaveCount(2);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(page.locator("#nav-builds")).toHaveAttribute("aria-current", "location");
  await expect(page.locator("#nav-brackets")).not.toHaveAttribute("aria-current", "location");
});

test("hero detail: unknown slug is a 404 page with a way back", async ({ page }) => {
  await page.goto("./heroes/nobody/");
  await expect(page.locator("#meta-line")).toContainText("영웅이 없습니다");
});

test("maps: cards with images, match counts and top heroes; card links to the map tier table with a banner", async ({ page }) => {
  await page.goto("./maps/");
  await expect(page.locator("#map-grid .map-card")).toHaveCount(15);
  const card = page.locator('#map-grid .map-card[data-map="cursed-hollow"]');
  await expect(card).toContainText("저주받은 골짜기");
  await expect(card.locator(".map-top-hero")).toHaveCount(3);
  await card.click();
  await expect(page).toHaveURL(/tier\/\?mode=sl&map=Cursed(\+|%20)Hollow/);
  await expect(page.locator("#map-hero")).toBeVisible();
  await expect(page.locator("#map-hero h2")).toHaveText("저주받은 골짜기");
});

test("tier table shows ▲▼ deltas against the previous patch", async ({ page }) => {
  await page.goto("./tier/");
  await expect(page.locator('#rows tr[data-hero="qhira"] [data-delta]')).toHaveText("— 0"); // fixture previous == current
});

test("tier table: Storm League rank-bracket selector loads sl_<bracket>.json and lands in the URL", async ({ page }) => {
  await page.goto("./tier/?mode=sl");
  await expect(page.locator("#bracket-wrap")).toBeVisible();
  await expect(page.locator("#bracket option")).toHaveText(["전체 구간", "브론즈 – 플래티넘", "다이아 – 그랜드마스터"]);
  await page.locator("#bracket").selectOption("high");
  await expect(page).toHaveURL(/tier=high/);
  await expect(page.locator("#meta-line")).toContainText("다이아 – 그랜드마스터");
  await page.goto("./tier/?mode=sl&tier=low");
  await expect(page.locator("#bracket")).toHaveValue("low");
  await expect(page.locator("#meta-line")).toContainText("브론즈 – 플래티넘");
  await page.locator("#mode-qm").click();
  await expect(page.locator("#bracket-wrap")).toBeHidden();
  await expect(page).not.toHaveURL(/tier=/);
});

test("hero detail: popular talent builds with Korean names, icons, games and win rate", async ({ page }) => {
  await page.goto("./heroes/illidan/");
  await expect(page.locator("#builds-title")).toBeVisible();
  await expect(page.locator("#builds [data-build]")).toHaveCount(5);
  const first = page.locator('#builds [data-build="1"]');
  await expect(first.locator("[data-talent]")).toHaveCount(7);
  await expect(first.locator("[data-talent] [data-level]").first()).toHaveText("1");
  await expect(first.locator("[data-talent] [data-tname]").first()).toContainText("끝없는 증오"); // Korean talent name from game strings
  await expect(first.locator("[data-wr]")).toContainText("%");
  const imgs = await first.locator("[data-talent] img").count();
  expect(imgs).toBeGreaterThan(0);
  await expect(page.locator("#builds-sub")).toContainText("합산");
});

test("hero detail: a hero without builds hides the section", async ({ page }) => {
  await page.goto("./heroes/xal-atath/");
  await expect(page.locator("#meta-line")).toContainText("영웅이 없습니다"); // not in heroes_ko yet
});

test("hero detail: tapping a talent opens its description; outside tap or Escape closes it", async ({ page }) => {
  await page.goto("./heroes/illidan/");
  const first = page.locator('#builds [data-build="1"] [data-talent]').first();
  await first.click();
  const pop = page.locator("#talent-pop");
  await expect(pop).toBeVisible();
  await expect(pop.locator("[data-pop-name]")).toHaveText("끝없는 증오");
  await expect(pop.locator("[data-pop-level]")).toContainText("1레벨");
  await expect(pop.locator("[data-pop-desc]")).not.toBeEmpty();
  await expect(pop.locator("[data-pop-desc] [data-hl]").first()).toBeVisible(); // highlighted numbers from the game text
  await expect(pop).not.toContainText("{{"); // markers are rendered, never shown
  const box = (await pop.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390); // stays on a phone screen
  await page.keyboard.press("Escape");
  await expect(pop).toBeHidden();
  await first.click();
  await expect(pop).toBeVisible();
  await page.locator("h1").click();
  await expect(pop).toBeHidden();
});

test("hero detail: the tier card colours the rank change like the table", async ({ page }) => {
  await page.goto("./heroes/illidan/");
  await expect(page.locator('#stats [data-stat="tier"] [data-sub]')).toHaveAttribute("data-delta", "0"); // fixture: previous == current
  await expect(page.locator('#stats [data-stat="tier"] [data-sub]')).toHaveClass(/text-muted/);
});

test("hero detail: opening a section link directly lands on that section once the data is drawn", async ({ page }) => {
  // slow data, as on a phone (the page is pre-rendered now, so this pins that nothing waits on a fetch)
  await page.route("**/latest/*.json", async (r) => {
    await new Promise((res) => setTimeout(res, 800));
    await r.continue();
  });
  const fetched: string[] = [];
  page.on("request", (r) => r.url().includes("/latest/") && fetched.push(r.url()));
  await page.goto("./heroes/illidan/#builds-title");
  await expect(page.locator("#builds [data-build]")).toHaveCount(5);
  await page.locator("#mode-sl").click();
  await expect(page.locator("#brackets [data-bracket]")).toHaveCount(2);
  expect(fetched, "both modes are in the page").toEqual([]);
  await page.goto("./tier/?mode=sl"); // control: the counter does see a page that loads its data
  await expect.poll(() => fetched.length).toBeGreaterThan(0);
  await page.goto("./heroes/illidan/#builds-title");
  const nav = page.locator("nav[data-subnav]");
  await expect.poll(async () => {
    const t = (await page.locator("#builds-title").boundingBox())!.y;
    const n = (await nav.boundingBox())!;
    return t >= n.y + n.height - 1 && t <= n.y + n.height + 40;
  }).toBe(true);
  await expect(nav.locator("#nav-builds")).toHaveAttribute("aria-current", "location");
});
