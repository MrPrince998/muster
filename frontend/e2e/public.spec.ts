import { expect, openClub, openEvent, test } from "./helpers";

// A public event, as someone without an account sees it.

test("anyone with the link can ask for a place", async ({ page, browser }) => {
  await openClub(page, "Robotics Society");
  const panel = await openEvent(page, "Robot Wars Viewing");
  const href = await panel.getByRole("link", { name: "Open page" }).getAttribute("href");
  expect(href).toMatch(/^\/e\/[0-9a-f-]{36}$/);

  // a stranger: a fresh browser, never signed in
  const stranger = await browser.newContext({ storageState: undefined });
  const guest = await stranger.newPage();
  await guest.goto(href!);
  await expect(guest.getByRole("heading", { level: 1, name: "Robot Wars Viewing" })).toBeVisible();
  await expect(guest.getByText(/places left/)).toBeVisible();

  const card = guest.getByRole("complementary", { name: "Get a ticket" });
  await card.getByRole("button", { name: "Get a ticket" }).click();
  await expect(card.getByText("Your name goes on the ticket")).toBeVisible();
  await card.getByLabel("Your name").fill("Wendy Walker");
  await card.getByLabel("Email").fill("wendy.walker@example.test");
  await card.getByRole("button", { name: "Get a ticket" }).click();
  await expect(card.getByText("Check your inbox")).toBeVisible();
  await stranger.close();
});

test("a members-only event isn't public", async ({ browser }) => {
  const stranger = await browser.newContext({ storageState: undefined });
  const page = await stranger.newPage();
  await page.goto("/e/00000000-0000-4000-8000-000000000000");
  await expect(page.getByRole("heading", { name: "No event here" })).toBeVisible();
  await stranger.close();
});
