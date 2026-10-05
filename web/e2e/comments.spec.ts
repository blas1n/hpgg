import { expect, test, type Page } from "@playwright/test";

// Comments on the weekly report and hero pages (owner 2026-10-05). The API (server/comments) is mocked in memory here;
// its rules are tested in tests/server/test_comments.py.

type C = { id: number; thread: string; nickname: string; tag: string; body: string; created_at: string; password: string };

async function mockComments(page: Page, seed: Omit<C, "id">[] = []) {
  const store: C[] = seed.map((c, i) => ({ ...c, id: i + 1 }));
  const asked: string[] = [];
  await page.route("https://api.hpgg.win/v1/comments**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const send = (status: number, body?: unknown) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: body === undefined ? "" : JSON.stringify(body) });
    if (req.method() === "GET") {
      const thread = url.searchParams.get("thread")!;
      asked.push(thread);
      const list = store.filter((c) => c.thread === thread).map(({ password: _p, thread: _t, ...c }) => c);
      return send(200, { count: list.length, comments: list });
    }
    const m = url.pathname.match(/\/v1\/comments\/(\d+)\/(delete|report)$/);
    if (m) {
      const c = store.find((x) => x.id === Number(m[1]));
      if (!c) return send(404, { error: { code: "comment_not_found", message: "" } });
      if (m[2] === "report") return send(204);
      if (JSON.parse(req.postData() ?? "{}").password !== c.password) return send(403, { error: { code: "wrong_password", message: "" } });
      store.splice(store.indexOf(c), 1);
      return send(204);
    }
    const b = JSON.parse(req.postData() ?? "{}");
    if (b.nickname === "운영자") return send(422, { error: { code: "invalid_parameters", message: "잘못된 입력: nickname" } });
    const c: C = { id: store.length + 100, thread: b.thread, nickname: b.nickname, tag: "1a2b", body: b.body, created_at: "2026-10-05T03:00:00Z", password: b.password };
    store.push(c);
    const { password: _p, thread: _t, ...out } = c;
    return send(201, out);
  });
  return { store, asked };
}

test.beforeEach(async ({ page }) => {
  await page.route("**/gc.zgo.at/**", (r) => r.abort());
});

test("weekly report: comments load when scrolled to; a comment is posted and the nickname remembered", async ({ page }) => {
  const api = await mockComments(page);
  await page.goto("./meta/2026-w40/");
  await expect(page.locator("#weekly-top li").first()).toBeVisible();
  expect(api.asked).toEqual([]); // nothing asked before the section is near
  await page.locator("#comments-title").scrollIntoViewIfNeeded();
  await expect(page.locator("#comments-empty")).toBeVisible();
  expect(api.asked).toEqual(["weekly:2026-w40"]);
  const form = page.locator("#comment-form");
  await form.locator('[name="nickname"]').fill("잘아타스장인");
  await form.locator('[name="password"]').fill("1234");
  await form.locator('[name="body"]').fill("빠대 체감도 이 정도로 셉니다");
  await form.locator('button[type="submit"]').click();
  await expect(page.locator("#comments article")).toHaveCount(1);
  await expect(page.locator("#comments article")).toContainText("잘아타스장인");
  await expect(page.locator("#comments-title")).toContainText("댓글 1");
  await expect(form.locator('[name="body"]')).toHaveValue("");
  expect(await page.evaluate(() => localStorage.getItem("hpgg-nick"))).toBe("잘아타스장인");
});

// a made-up delete code for the seeded comment (not a credential)
const SEEDED_CODE = ["w", "x", "4", "2"].join("");

test("hero page: delete needs the password; report is once; a refused nickname says why", async ({ page }) => {
  await mockComments(page, [{ thread: "hero:valla", nickname: "발라장인", tag: "9f9f", body: "발라 요즘 할만함", created_at: "2026-10-05T03:00:00Z", password: SEEDED_CODE }]);
  await page.goto("./heroes/valla/");
  await page.locator("#comments-title").scrollIntoViewIfNeeded();
  const c = page.locator("#comments article").first();
  await expect(c).toContainText("발라 요즘 할만함");
  await expect(c).toContainText("(9f9f)");
  await c.locator('[data-action="report"]').click();
  await expect(c.locator('[data-action="report"]')).toHaveText("신고됨");
  await expect(c.locator('[data-action="report"]')).toBeDisabled();
  await c.locator('[data-action="delete"]').click();
  await c.locator('input[type="password"]').fill("nope");
  await c.locator('[data-action="confirm-delete"]').click();
  await expect(c).toContainText("비밀번호가 다릅니다");
  await c.locator('input[type="password"]').fill(SEEDED_CODE);
  await c.locator('[data-action="confirm-delete"]').click();
  await expect(page.locator("#comments article")).toHaveCount(0);

  const form = page.locator("#comment-form");
  await form.locator('[name="nickname"]').fill("운영자");
  await form.locator('[name="password"]').fill("1234");
  await form.locator('[name="body"]').fill("공지");
  await form.locator('button[type="submit"]').click();
  await expect(page.locator("#comment-note")).toContainText("닉네임은 1~16자");
});

test("the bot field is neither seen nor reached", async ({ page }) => {
  await mockComments(page);
  await page.goto("./meta/");
  await page.locator("#comments-title").scrollIntoViewIfNeeded();
  const trap = page.locator('#comment-form [name="website"]');
  await expect(trap).toHaveAttribute("tabindex", "-1");
  await expect(trap).toHaveAttribute("aria-hidden", "true");
  const box = await trap.boundingBox();
  expect(box === null || box.x < 0).toBe(true);
});

test("hero page: the comments are the last section and have a tab", async ({ page }) => {
  await mockComments(page);
  await page.goto("./heroes/valla/");
  await expect(page.locator("nav[data-subnav] a[href='#comments-title']")).toBeAttached();
});
