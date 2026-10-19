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
