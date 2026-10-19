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

test("buy a ticket for a paid event, then give it back for a refund", async ({ page }) => {
  await openClub(page, "Robotics Society");
  const panel = await openEvent(page, "Robotics Gala Dinner");
  await expect(panel.getByText("Refunded if given back 48 hours or more before it starts")).toBeVisible();

  // development's pretend Stripe: checkout is paid at once and comes straight back
  await panel.getByRole("button", { name: "Buy a ticket for $45.00" }).click();
  // its questions first: the dietary one is required
  const questions = page.getByRole("dialog");
  await questions.getByRole("button", { name: "Go to checkout" }).click();
  await expect(questions.getByText("Choose one")).toBeVisible();
  await questions.getByText("Vegetarian", { exact: true }).click();
  await questions.getByLabel(/Anything the kitchen should know/).fill("No coriander, please");
  await questions.getByRole("button", { name: "Go to checkout" }).click();
  await expect(page).toHaveURL(/paid=1/);
  const back = page.getByRole("complementary", { name: "Robotics Gala Dinner" });
  await expect(back.getByText("You’re going.")).toBeVisible({ timeout: 15_000 });
  // the organiser's takings
  await expect(back.getByText("in ticket sales, less refunds")).toBeVisible();
  // the organiser's tally of the answers
  const said = back.getByRole("region", { name: "Answers" });
  await expect(said.getByRole("listitem").filter({ hasText: "Vegetarian" })).toHaveText(/Vegetarian\s*1/);

  await back.getByRole("button", { name: "Cancel my place" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm.getByText(/You'll get \$45\.00 back/)).toBeVisible();
  await confirm.getByRole("button", { name: "Give it back and refund" }).click();
  await expect(back.getByRole("button", { name: "Buy a ticket for $45.00" })).toBeVisible();
});
