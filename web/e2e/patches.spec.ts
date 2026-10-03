import { expect, test } from "@playwright/test";

// 패치 요약 (owner 2026-10-03). The e2e data's reference patch is one build (2.55.17.98025) that no note or hotfix
// belongs to, so this checks the page around an empty patch; the rows are tested in tests/patchSummary.test.ts.

test.beforeEach(async ({ page }) => {
  await page.route("**/gc.zgo.at/**", (r) => r.abort());
});

test("패치 is in the menu and opens the patch summary", async ({ page }) => {
  await page.goto("./");
  await page.locator('header a[data-page="patches"]:visible').first().click(); // the menu is in the header twice (phone, desktop)
  await expect(page).toHaveURL(/\/ko\/hots\/patches\/$/);
  await expect(page.locator("h1")).toHaveText("패치 요약");
  await expect(page.locator('header a[data-page="patches"][aria-current="page"]').first()).toBeAttached();
});

test("a patch nothing changed says so, in numbers, and still compares with the previous patch", async ({ page }) => {
  await page.goto("./patches/");
  await expect(page.locator("#meta-line")).toContainText("패치 2.55.17.98025 · 직전 2.55.17.97771 대비");
  await expect(page.locator("#patch-summary")).toContainText("공식 패치 노트: 버프 0 · 너프 0 · 조정 0");
  await expect(page.getByText("이 패치의 공식 패치 노트가 아직 없습니다")).toBeVisible();
  await expect(page.locator("#patch-rows")).toHaveCount(0);
  await expect(page.getByText("이 패치에 바뀐 영웅이 없습니다")).toBeVisible();
});

test("the mode toggle lands in the URL", async ({ page }) => {
  await page.goto("./patches/");
  await page.locator("#mode-sl").click();
  await expect(page).toHaveURL(/\/patches\/\?mode=sl$/);
  await expect(page.locator("#meta-line")).toContainText("폭풍 리그");
});
