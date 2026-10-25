import { DEMO, expect, openClub, openEvent, RIVERSIDE, test } from "./helpers";

// Getting around: search, the account page, signing out and back in.

test("search finds an event and opens it", async ({ page }) => {
  await page.goto(`/o/${RIVERSIDE}`);
  await page.getByRole("button", { name: /Search pages, clubs, events and people/ }).click();
  const search = page.getByRole("dialog");
  await search.getByRole("combobox").fill("ghibli");
  await expect(search.getByRole("option", { name: /Studio Ghibli Night/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("complementary", { name: "Studio Ghibli Night" })).toBeVisible();
});

test("search goes straight to a page: tickets, or a workspace's settings", async ({ page }) => {
  await page.goto(`/o/${RIVERSIDE}`);
  await page.getByRole("button", { name: /Search pages, clubs, events and people/ }).click();
  const search = page.getByRole("dialog");
  await search.getByRole("combobox").fill("ticket");
  await expect(search.getByRole("option", { name: /My tickets/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/tickets$/);

  await page.getByRole("button", { name: /Search pages, clubs, events and people/ }).click();
  // by another word for it
  await search.getByRole("combobox").fill("time zone");
  await search.getByRole("option", { name: /Workspace settings/ }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${RIVERSIDE}/settings$`));
});

test("the account page shows your pass", async ({ page }) => {
  await page.goto("/account");
  const pass = page.getByRole("figure", { name: "Your Muster pass" });
  await expect(pass.getByText(DEMO.name)).toBeVisible();
  await expect(pass.getByText("Riverside University")).toBeVisible();
});

test("signing out, and a wrong password", async ({ browser }) => {
  // its own session: signing out ends it on the server, and the other tests share theirs
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(DEMO.email);
  await page.getByLabel("Password", { exact: true }).fill(DEMO.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/(o\/|workspaces)/);

  await page.getByRole("button", { name: "Your account" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel("Email").fill(DEMO.email);
  await page.getByLabel("Password", { exact: true }).fill("not the password");
  await page.getByRole("button", { name: "Sign in" }).click();
  // (Next keeps an empty route announcer with role alert on every page: look for ours)
  await expect(page.getByRole("alert").filter({ hasText: /email or password/i })).toBeVisible();
  await context.close();
});

test("a club in another time zone shows its own clock, and says so", async ({ page }) => {
  // Northside Makers meets in Perth; the browser here isn't in Perth
  await openClub(page, "3D Printing Guild", "northside-makers");
  const panel = await openEvent(page, "Print Your First Part");
  await expect(panel.getByText(/^10:00 to 13:00/)).toBeVisible();
  await expect(panel.getByText(/Perth time \(AWST\)/)).toBeVisible();
});

test("owners choose the workspace's time zone in Settings", async ({ page }) => {
  await page.goto(`/o/${RIVERSIDE}/settings`);
  const section = page.getByRole("region", { name: "Time zone" });
  await expect(section.getByRole("combobox", { name: "Time zone" })).toBeVisible();
  await expect(section.getByRole("button", { name: "Save time zone" })).toBeDisabled();
});

test("subscribe to a club's events in a calendar app", async ({ page }) => {
  await openClub(page, "Robotics Society");
  await page.getByRole("button", { name: "Follow" }).click();
  await page.getByRole("menuitem", { name: "Add to my calendar…" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Robotics Society in your calendar" })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Apple or Outlook" })).toHaveAttribute("href", /^webcal:\/\/.+\/feeds\/.+\.ics$/);

  // what a calendar app fetches: no session, the link is enough
  const link = await dialog.getByLabel(/copy the link/).inputValue();
  const feed = await page.context().request.get(link, { headers: { cookie: "" } });
  expect(feed.headers()["content-type"]).toBe("text/calendar; charset=utf-8");
  const ics = await feed.text();
  expect(ics).toContain("X-WR-CALNAME:Robotics Society\\, Riverside University");
  expect(ics).toContain("SUMMARY:Build Night");
});

test("choose new-event emails for a club, and a broken stop link says so", async ({ page }) => {
  await openClub(page, "Robotics Society");
  await page.getByRole("button", { name: "Follow" }).click();
  await page.getByRole("menuitemradio", { name: /Weekly digest/ }).click();
  await expect(page.getByRole("button", { name: "Following" })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Following" }).click();
  await expect(page.getByRole("menuitemradio", { name: /Weekly digest/ })).toBeChecked();
  await page.keyboard.press("Escape");

  await page.goto("/unsubscribe?token=c.nope");
  await page.getByRole("button", { name: "Stop these emails" }).click();
  await expect(page.getByRole("heading", { name: "This link doesn’t work" })).toBeVisible();
});

test("the members list searches the whole workspace, not just what's loaded", async ({ page }) => {
  await page.goto(`/o/${RIVERSIDE}/members`);
  await expect(page.getByText(/^\d+ people in Riverside University/)).toBeVisible();
  const asked: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/members?")) asked.push(new URL(r.url()).searchParams.get("q") ?? "");
  });
  await page.getByRole("searchbox", { name: "Search members" }).pressSequentially("priya", { delay: 60 });
  await expect(page.getByRole("listitem").filter({ hasText: "Priya Tanaka" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "@muster.test" })).toHaveCount(1);
  // one request for the whole word, once typing paused
  expect(asked).toEqual(["priya"]);
});
