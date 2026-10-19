import { expect, openClub, openEvent, test } from "./helpers";

// A member's side of an event: a place, the ticket, giving it back, and the waitlist.

test("register for an event, see the ticket, give the place back", async ({ page }) => {
  await openClub(page, "Film Club");
  const panel = await openEvent(page, "Short Film Showcase");

  await panel.getByRole("button", { name: "Register" }).click();
  await expect(panel.getByText("You’re going.")).toBeVisible();

  await panel.getByRole("button", { name: "Show my ticket" }).click();
  const ticket = page.getByRole("dialog");
  await expect(ticket.getByRole("heading", { name: "Short Film Showcase" })).toBeVisible();
  await expect(ticket.getByRole("img", { name: /QR code for Sam Rivera/ })).toBeVisible();

  // into a calendar: the file (Apple, Outlook and the rest), or Google's own page
  await ticket.getByRole("button", { name: "Add to calendar" }).click();
  await expect(page.getByRole("menuitem", { name: "Google Calendar" })).toHaveAttribute(
    "href",
    /^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE&text=Short\+Film\+Showcase&dates=\d{8}T\d{6}Z%2F\d{8}T\d{6}Z/,
  );
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: "Apple, Outlook and others" }).click(),
  ]);
  expect(file.suggestedFilename()).toBe("short-film-showcase.ics");

  // the ticket as a picture, for the door with no signal: never cached on the way
  const saved = await ticket.getByRole("link", { name: "Save ticket image" }).getAttribute("href");
  const image = await page.request.get(saved!);
  expect(image.headers()["content-type"]).toBe("image/png");
  expect(image.headers()["cache-control"]).toBe("private, no-store");
  expect(image.headers()["content-disposition"]).toBe('inline; filename="short-film-showcase-ticket.png"');
  expect((await image.body()).length).toBeGreaterThan(20_000);
  expect((await page.request.get("/t/not-a-ticket/image")).status()).toBe(404);
  await page.keyboard.press("Escape");

  await panel.getByRole("button", { name: "Cancel my place" }).click();
  await expect(panel.getByRole("button", { name: "Register" })).toBeVisible();
});

test("a full event offers its waitlist, and you can leave it", async ({ page }) => {
  await openClub(page, "Robotics Society");
  const panel = await openEvent(page, "Soldering Workshop");
  await expect(panel.getByText("Full. 3 waiting for a place.")).toBeVisible();

  await panel.getByRole("button", { name: "Join the waitlist" }).click();
  await expect(panel.getByText("You're number 4 on the waitlist.")).toBeVisible();
  await expect(page.getByRole("button", { pressed: true }).filter({ hasText: "Waitlist, number 4" })).toBeVisible();

  await panel.getByRole("button", { name: "Leave the waitlist" }).click();
  await expect(panel.getByRole("button", { name: "Join the waitlist" })).toBeVisible();
});

test("my tickets lists the seeded ones and opens a QR code", async ({ page }) => {
  await page.goto("/tickets");
  await expect(page.getByText("Studio Ghibli Night")).toBeVisible();
  await expect(page.getByText("Robot Wars Viewing")).toBeVisible();
  await page.getByText("Studio Ghibli Night").click();
  await expect(page.getByRole("dialog").getByRole("img", { name: /QR code/ })).toBeVisible();
});
