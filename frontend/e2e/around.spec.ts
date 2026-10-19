import { DEMO, expect, RIVERSIDE, test } from "./helpers";

// Getting around: search, the account page, signing out and back in.

test("search finds an event and opens it", async ({ page }) => {
  await page.goto(`/o/${RIVERSIDE}`);
  await page.getByRole("button", { name: /Search clubs, events and people/ }).click();
  const search = page.getByRole("dialog");
  await search.getByRole("combobox").fill("ghibli");
  await expect(search.getByRole("option", { name: /Studio Ghibli Night/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("complementary", { name: "Studio Ghibli Night" })).toBeVisible();
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
