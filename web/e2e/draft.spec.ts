import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/gc.zgo.at/**", (r) => r.abort());
});

// 밴픽 simulator (#25) against the frozen e2e data set (only Abathur has a matchups file there).
const abathur = JSON.parse(readFileSync(new URL("../tests/e2e-data/matchups/abathur.json", import.meta.url), "utf-8"));

const choose = (page: Page, slug: string) => page.locator(`#draft-heroes button[data-hero="${slug}"]`).click();
const slot = (page: Page, team: "us" | "them", kind: "ban" | "pick", n: number) => page.locator(`[data-slot="${team}-${kind}-${n}"]`);

test("draft: the real order, turn prompt, suggestions with their terms, and the link keeps it all", async ({ page }) => {
  await page.goto("./draft/");
  await expect(page.locator("h1")).toHaveText("밴픽 시뮬레이터");
  await expect(page.locator("#draft-turn")).toHaveText("우리 팀이 금지합니다");
  await expect(page.locator("#draft-suggest-title")).toHaveText("추천 밴");
  await expect(page.locator('[data-slot^="us-ban"]')).toHaveCount(3);
  await expect(page.locator('[data-slot^="them-pick"]')).toHaveCount(5);

  // 4 bans: us, them, us, them
  for (const s of ["illidan", "zeratul", "tracer", "genji"]) await choose(page, s);
  await expect(slot(page, "us", "ban", 1)).toHaveAttribute("data-hero", "illidan");
  await expect(slot(page, "them", "ban", 2)).toHaveAttribute("data-hero", "genji");
  await expect(page.locator("#draft-turn")).toHaveText("우리 팀이 선택합니다");
  await expect(page.locator("#draft-suggest-title")).toHaveText("추천 픽");
  // a banned hero is no longer offered
  await expect(page.locator('#draft-heroes button[data-hero="illidan"]')).toHaveCount(0);

  await choose(page, "abathur"); // our first pick
  await expect(page.locator("#draft-turn")).toHaveText("상대 팀이 선택합니다");
  await choose(page, "uther");
  await choose(page, "muradin");

  // our pick with Abathur on the team: Samuro's ally term is Abathur's gap with Samuro, shrunk (the hero page's rule)
  const row = abathur.ally.find((r: { hero: string }) => r.hero === "Samuro");
  const expected = ((row.win_rate - abathur.win_rate) * row.games) / (row.games + 100);
  const samuro = page.locator('#draft-suggest [data-hero="samuro"]');
  await expect(samuro.locator("[data-term=allies]")).toHaveText(`+${expected.toFixed(1)}`);
  // Uther and Muradin have no matchups file in the e2e data: said, not hidden
  await expect(page.locator("#draft-missing")).toContainText("우서");

  // the link replays the draft
  await expect(page).toHaveURL(/d=illidan\.zeratul\.tracer\.genji\.abathur\.uther\.muradin/);
  await page.reload();
  await expect(slot(page, "us", "pick", 1)).toHaveAttribute("data-hero", "abathur");
  await expect(slot(page, "them", "pick", 2)).toHaveAttribute("data-hero", "muradin");
  await expect(page.locator("#draft-turn")).toHaveText("우리 팀이 선택합니다");

  // undo, then start over
  await page.locator("#draft-undo").click();
  await expect(slot(page, "them", "pick", 2)).not.toHaveAttribute("data-hero", /.+/);
  await page.locator("#draft-reset").click();
  await expect(page).not.toHaveURL(/d=/);
  await expect(page.locator("#draft-turn")).toHaveText("우리 팀이 금지합니다");
});

test("draft: Cho'gall fills both slots of the team that picks twice, and undo takes both back", async ({ page }) => {
  await page.goto("./draft/?first=them&d=illidan.zeratul.tracer.genji.abathur");
  // they picked first (Abathur), we pick twice now
  await expect(page.locator("#draft-first-them")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#draft-turn")).toHaveText("우리 팀이 선택합니다");
  await choose(page, "cho");
  await expect(slot(page, "us", "pick", 1)).toHaveAttribute("data-hero", "cho");
  await expect(slot(page, "us", "pick", 2)).toHaveAttribute("data-hero", "gall");
  await expect(page.locator("#draft-turn")).toHaveText("상대 팀이 선택합니다");
  // they pick twice too, but the next slot after that is ours: no Cho'gall where it would split
  await page.locator("#draft-undo").click();
  await expect(slot(page, "us", "pick", 1)).not.toHaveAttribute("data-hero", /.+/);
});

test("draft: the map changes the map term and lands in the URL; the first-pick toggle is fixed once the draft started", async ({ page }) => {
  await page.goto("./draft/");
  await page.locator("#draft-map").selectOption("Cursed Hollow");
  await expect(page).toHaveURL(/map=Cursed(\+|%20)Hollow/);
  // at least one suggestion carries a map term now (a hero's own record on that map)
  await expect.poll(async () => (await page.locator('#draft-suggest [data-term="map"]').allTextContents()).some((x) => x !== "0.0")).toBe(true);
  await choose(page, "illidan");
  await expect(page.locator("#draft-first-them")).toBeDisabled();
});

test("draft: in the header nav, and no horizontal scroll on a phone", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator('header a[data-page="draft"]').first()).toHaveAttribute("href", "/ko/hots/draft/");
  await page.goto("./draft/");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.locator("#draft-rule")).toContainText("n/(n+100)");
});
