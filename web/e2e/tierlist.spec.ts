import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/gc.zgo.at/**", (r) => r.abort());
});

// Built against web/tests/e2e-data (frozen 2026-09-28 fixtures), see `npm run e2e`.

const row = (page: Page, slug: string) => page.locator(`#rows tr[data-hero="${slug}"]`);
const tierOf = async (page: Page, slug: string) => row(page, slug).getAttribute("data-tier");

test("default view is Quick Match, all maps, no map dropdown, ban column hidden; expected tiers", async ({ page }) => {
  await page.goto("./tier/");
  await expect(page.locator("#meta-line")).toContainText("빠른 대전");
  await expect(page.locator("#mode-qm")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#map-wrap")).toBeHidden();
  await expect(page.locator('th[data-col="ban_rate"]')).toBeHidden();
  expect(await tierOf(page, "illidan")).toBe("B");
  expect(await tierOf(page, "azmodan")).toBe("S");
  expect(await tierOf(page, "brightwing")).toBe("A");
  // default order is by score: first row is rank #1
  await expect(page.locator("#rows tr[data-hero]").first()).toHaveAttribute("data-hero", "qhira");
  await expect(page.locator("#rows tr[data-hero]").first().locator('td[data-col="rank"] [data-v]')).toHaveText("1");
});

test("score, win rate, pick rate and sample size all show plain numbers (no single-metric emphasis)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 }); // the sample column is desktop-only
  await page.goto("./tier/");
  const r = row(page, "illidan");
  for (const col of ["score", "win_rate", "pick", "games"]) await expect(r.locator(`td[data-col="${col}"] [data-v]`)).not.toHaveText("");
  await expect(r.locator('td[data-col="win_rate"] [data-v]')).toContainText("%");
  await expect(r.locator('td[data-col="tier"] .tier-badge')).toHaveText("B");
});

test("sorting by pick rate reorders rows and is reflected in the URL; tiers stay", async ({ page }) => {
  await page.goto("./tier/");
  await page.locator('th[data-sort="pick"] button').click();
  await expect(page).toHaveURL(/sort=pick/);
  await expect(page.locator('th[data-sort="pick"]')).toHaveAttribute("aria-sort", "descending");
  await expect(page.locator("#rows tr[data-hero]").first()).toHaveAttribute("data-hero", "abathur"); // 35% pick in QM
  expect(await tierOf(page, "abathur")).toBe("S");
  await page.locator('th[data-sort="pick"] button').click();
  await expect(page.locator('th[data-sort="pick"]')).toHaveAttribute("aria-sort", "ascending");
  await expect(page).toHaveURL(/dir=asc/);
});

test("the rank and tier headers return a re-sorted table to the ranked order", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 }); // the tier column is from 640px
  for (const col of ["rank", "tier"]) {
    await page.goto("./tier/?sort=win_rate&dir=asc");
    await expect(page.locator('th[data-sort="win_rate"]')).toHaveAttribute("aria-sort", "ascending");
    await page.locator(`th[data-col="${col}"] button`).click();
    await expect(page).not.toHaveURL(/sort=|dir=/);
    await expect(page.locator('th[data-sort="score"]')).toHaveAttribute("aria-sort", "descending");
    await expect(page.locator("#rows tr[data-hero]").first()).toHaveAttribute("data-hero", "qhira");
    await expect(page.locator("#rows tr[data-tier-group]").first()).toBeVisible(); // tier dividers are back
  }
});

test("the rank header is a button on a phone too (the tier column is folded there)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("./tier/?sort=pick");
  await page.locator('th[data-col="rank"] button').click();
  await expect(page).not.toHaveURL(/sort=/);
  await expect(page.locator("#rows tr[data-hero]").first()).toHaveAttribute("data-hero", "qhira");
});

test("role filter hides other roles but keeps tiers (computed on everyone)", async ({ page }) => {
  await page.goto("./tier/");
  await page.locator("#roles button", { hasText: "치유사" }).click();
  await expect(page).toHaveURL(/role=Healer/);
  await expect(row(page, "brightwing")).toBeVisible();
  await expect(row(page, "illidan")).toHaveCount(0);
  expect(await tierOf(page, "brightwing")).toBe("A");
});

test("Storm League: map dropdown and ban column appear, tiers change", async ({ page }) => {
  await page.goto("./tier/");
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route("**/latest/sl.json", async (route) => {
    await held;
    await route.continue();
  });
  await page.locator("#mode-sl").click();
  await expect(page.locator("#meta-line")).toHaveText("불러오는 중…"); // never the QM numbers under a Storm League label
  await expect(page.locator("#table")).toHaveAttribute("aria-busy", "true");
  release();
  await expect(page.locator("#table")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#map-wrap")).toBeVisible();
  await expect(page.locator('th[data-col="ban_rate"]')).toBeVisible();
  await expect(page).toHaveURL(/mode=sl/);
  expect(await tierOf(page, "illidan")).toBe("A");
  expect(await tierOf(page, "brightwing")).toBe("F");
  await expect(row(page, "brightwing").locator('td[data-col="ban_rate"] [data-v]')).toContainText("%");
  // in Storm League the row goes to the hero page in Storm League
  await expect(row(page, "brightwing").locator("a[data-link]")).toHaveAttribute("href", "/ko/hots/heroes/brightwing/?mode=sl");
});

test("selecting one map excludes thin rows from the cut and lists them as grey", async ({ page }) => {
  await page.goto("./tier/?mode=sl");
  await page.locator("#map").selectOption("Cursed Hollow");
  await expect(page).toHaveURL(/map=Cursed(\+|%20)Hollow/);
  await expect(page.locator("#meta-line")).toContainText("저주받은 골짜기");
  await expect(page.locator("#grey-wrap")).toBeVisible();
  const greyCount = await page.locator("#grey [data-hero]").count();
  expect(greyCount).toBeGreaterThan(0);
  const firstGrey = await page.locator("#grey [data-hero]").first().getAttribute("data-hero");
  await expect(row(page, firstGrey!)).toHaveCount(0);
});

test("a row goes straight to the hero page: the name is the link, a click anywhere on the row follows it, nothing expands", async ({ page }) => {
  await page.goto("./tier/");
  const link = row(page, "illidan").locator("a[data-link]");
  await expect(link).toHaveAttribute("href", "/ko/hots/heroes/illidan/");
  await expect(link).toHaveText("일리단");
  await expect(page.locator("#rows tr[data-detail]")).toHaveCount(0);
  await row(page, "illidan").locator('td[data-col="win_rate"]').click();
  await expect(page).toHaveURL(/\/ko\/hots\/heroes\/illidan\/$/);
  await expect(page.locator("h1")).toHaveText("일리단");
});

test("the table keeps its full width on a phone, with the name readable", async ({ page }) => {
  await page.goto("./tier/");
  const visibleCols = await page.locator("#table thead th:visible").count();
  expect(visibleCols).toBe(5); // phone: rank, hero, score, win rate, pick
  const tableW = (await page.locator("#table").boundingBox())!.width;
  const rowW = (await row(page, "qhira").boundingBox())!.width;
  expect(Math.abs(tableW - rowW)).toBeLessThanOrEqual(1);
  await expect(row(page, "qhira").locator("[data-name]")).toBeVisible();
});

test("?patch=previous shows the banner and previous-patch data; state round-trips through the URL", async ({ page }) => {
  await page.goto("./tier/?patch=previous");
  await expect(page.locator("#patch-banner")).toBeVisible();
  await expect(page.locator("#patch-banner")).toHaveText("새 패치 2.55.17.98025의 표본을 쌓는 중입니다. 현재 패치 보기");
  await expect(page.locator("#meta-line")).toContainText("2.55.17.97771");
  await page.goto("./tier/?mode=sl&map=Cursed%20Hollow&role=Tank&sort=win_rate");
  await expect(page.locator("#mode-sl")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#map")).toHaveValue("Cursed Hollow");
  await expect(page.locator('#roles button[data-role="Tank"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('th[data-sort="win_rate"]')).toHaveAttribute("aria-sort", "descending");
});

test("no horizontal scroll on a phone and the formula is printed", async ({ page }) => {
  await page.goto("./tier/?mode=sl");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const tableOverflow = await page.locator("#table").evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(tableOverflow).toBeLessThanOrEqual(0);
  await expect(page.locator("#formula")).toContainText("픽률 × (승률 − 50) × 3");
  await expect(page.locator("footer")).toContainText("Data provided by");
});

test("party correction (#36): Quick Match ranks by the corrected win rate, shows the raw one, and prints how", async ({ page }) => {
  await page.goto("./tier/");
  // the fixture corrects only The Butcher (52.56% → 44): it sinks to F, its win-rate cell stays raw
  expect(await tierOf(page, "the-butcher")).toBe("F");
  await expect(row(page, "the-butcher").locator('td[data-col="win_rate"]')).toContainText("52.6");
  await expect(page.locator("#formula")).toContainText("승률은 파티 보정(솔로 큐 기준, k=1000) 후 표본 수축(k=500)");
  await page.locator("#formula + details summary").click();
  await expect(page.locator("#formula + details pre")).toContainText("보정승률 = 승률 + (솔로승률 + 1.37 − 승률)");
  // the Storm League fixture has no correction: nothing is claimed
  await page.goto("./tier/?mode=sl");
  await expect(page.locator("#formula")).toContainText("픽률 × (승률 − 50) × 3");
  await expect(page.locator("#formula")).not.toContainText("파티 보정");
  await page.goto("/en/hots/tier/");
  await expect(page.locator("#formula")).toContainText("win rate party-corrected (solo-queue baseline, k=1000), then shrunk toward 50");
});

test("one formula: no formula selector, and an old ?preset= link opens the default view", async ({ page }) => {
  await page.goto("./tier/?mode=sl");
  await expect(page.locator("#preset")).toHaveCount(0);
  // the Storm League filters are the region, the bracket and the map
  await expect(page.locator("main select")).toHaveCount(3);
  await expect(page.locator("#region")).toBeVisible();
  await expect(page.locator("#bracket")).toBeVisible();
  await expect(page.locator("#map")).toBeVisible();
  await page.goto("./tier/?preset=additive&role=Tank");
  await expect(page).not.toHaveURL(/preset=/);
  await expect(page.locator("#formula")).toContainText("티어 점수 = 픽률 × (승률 − 50) × 3");
  await expect(page.locator("#rows tr[data-changed]")).toHaveCount(0);
});

test("keyboard: the hero name is a real link (no <tr role=button>), Enter opens the hero page (#30)", async ({ page }) => {
  await page.goto("./tier/?mode=sl");
  await expect(page.locator('#rows tr[role="button"], #rows [data-toggle]')).toHaveCount(0);
  const link = row(page, "qhira").locator("a[data-link]");
  // ?mode=sl is applied after hydration; before it the rows link to the Quick Match pages (CI flake, 2026-10-03)
  await expect(link).toHaveAttribute("href", /\?mode=sl$/);
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/ko\/hots\/heroes\/qhira\/\?mode=sl$/);
});

test("the formula line stays readable: at most about 90 characters wide on desktop (#30)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("./tier/");
  const ch = await page.locator("#formula").evaluate((el) => {
    const s = getComputedStyle(el);
    const c = document.createElement("span");
    c.textContent = "0";
    c.style.font = s.font;
    document.body.appendChild(c);
    const w = c.getBoundingClientRect().width;
    c.remove();
    return el.getBoundingClientRect().width / w;
  });
  expect(ch).toBeLessThanOrEqual(90);
});

test("a view with no file on the patch it shows says so, and never shows another patch's file in its place", async ({ page }) => {
  // the e2e previous patch has no region files: KR exists only on the current patch
  await page.goto("./tier/?region=kr&patch=previous");
  await expect(page.locator("#meta-line")).toContainText("패치 2.55.17.97771에는 이 보기의 데이터가 없습니다");
  await expect(page.locator("#meta-line")).not.toContainText("2.55.17.98025");
});

test("region menu follows the patch the table shows: a region backfilled into previous/ is selectable there", async ({ page }) => {
  // e2e meta.previous_modes lists EU only; on the current patch EU is not collected (KR, NA are)
  await page.goto("./tier/?patch=previous");
  await expect(page.locator("#region option")).toHaveText(["전체 지역", "아시아 (KR) · 수집 전", "아메리카 (NA) · 수집 전", "유럽 (EU)"]);
  // (picking a region resets the patch to the reference one, which is the current patch in e2e data: open it by URL)
  await page.goto("./tier/?region=eu&patch=previous");
  await expect(page.locator("#region")).toHaveValue("eu");
  await expect(page.locator("#region-note")).toContainText("09/26 수집");
  await expect(page.locator("#rows tr").first()).toBeVisible();
});
