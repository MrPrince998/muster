import { expect, localDateTime, openClub, openEvent, test } from "./helpers";

// An organiser's side: making an event, calling one off, and the door.

test("create and publish an event, then cancel it with a note", async ({ page }) => {
  await openClub(page, "Robotics Society");
  await page.getByRole("button", { name: "New event" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Name", { exact: true }).fill("Browser Test Night");
  await form.locator("#event-starts").fill(localDateTime(20, 18));
  await form.locator("#event-ends").fill(localDateTime(20, 21));
  await form.locator("#event-location").fill("Engineering Hall B");
  await form.locator("#event-capacity").fill("30");
  await form.getByRole("button", { name: "Publish" }).click();

  const panel = page.getByRole("complementary", { name: "Browser Test Night" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("0 of 30")).toBeVisible();
  await expect(page.getByRole("button").filter({ hasText: "Browser Test Night" })).toBeVisible();

  await panel.getByRole("button", { name: "Cancel event" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm.getByText("Nobody has registered yet.")).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel event" }).click();
  await expect(panel.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Edit event" })).toHaveCount(0);
});

test("a weekly series: one form makes them all, and the rest are called off together", async ({ page }) => {
  await openClub(page, "Robotics Society");
  await page.getByRole("button", { name: "New event" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Name", { exact: true }).fill("Series Test Night");
  await form.locator("#event-starts").fill(localDateTime(22, 18));
  await form.locator("#event-ends").fill(localDateTime(22, 20));
  await form.getByLabel("Repeats").selectOption("week");
  await form.getByLabel("How many times").fill("3");
  await expect(form.getByText("Makes 3 events")).toBeVisible();
  await form.getByRole("button", { name: "Publish" }).click();

  const panel = page.getByRole("complementary", { name: "Series Test Night" });
  await expect(panel.getByText("Every week, 1 of 3")).toBeVisible();
  const cards = page.getByRole("button").filter({ hasText: "Series Test Night" });
  await expect(cards).toHaveCount(3);

  // the second, and the one after it
  await cards.filter({ hasText: "2 of 3" }).click();
  await expect(panel.getByText("Every week, 2 of 3")).toBeVisible();
  await panel.getByRole("button", { name: "Cancel event" }).click();
  const confirm = page.getByRole("alertdialog");
  await confirm.getByLabel(/This and following/).check();
  await confirm.getByRole("button", { name: "Cancel event" }).click();
  await expect(cards.filter({ hasText: "Cancelled" })).toHaveCount(2);
  await expect(cards.filter({ hasText: "1 of 3" }).getByText("Cancelled")).toHaveCount(0);
});

test("check someone in at the door by name", async ({ page }) => {
  await openClub(page, "Robotics Society");
  const panel = await openEvent(page, "Robot Wars Viewing");
  await panel.getByRole("link", { name: "Open check-in" }).click();
  await expect(page.getByRole("region", { name: "Check-in for Robot Wars Viewing" })).toBeVisible();

  await page.getByRole("tab", { name: "Find by name" }).click();
  // Sam (the demo user) holds a place here
  await page.getByLabel("Search attendees").fill("Sam");
  await page.getByRole("button", { name: "Check in" }).first().click();
  // the door's answer, and the count moves
  await expect(page.getByText("Let them in")).toBeVisible();
  await expect(page.getByText(/^of \d+ in/)).toBeVisible();
  await expect(page.getByText(/^In at \d{2}:\d{2}$/)).toBeVisible();
});

test("the door keeps going with no connection, and catches up once it's back", async ({ page, context }) => {
  await openClub(page, "Robotics Society");
  const panel = await openEvent(page, "Build Night");
  // the door's list comes down as check-in opens
  const roster = page.waitForResponse((res) => res.url().includes("/check-in/roster") && res.ok());
  await panel.getByRole("link", { name: "Open check-in" }).click();
  await expect(page.getByRole("region", { name: "Check-in for Build Night" })).toBeVisible();
  await roster;
  await expect(page.getByText(/^of 11 in/)).toBeVisible();

  await context.setOffline(true);
  await page.getByRole("tab", { name: "Find by name" }).click();
  await page.getByRole("button", { name: "Check in" }).first().click();
  await expect(page.getByText("Let them in")).toBeVisible();
  await expect(page.getByText(/Saved on this phone/)).toBeVisible();
  await expect(page.getByText("No connection.")).toBeVisible();
  await expect(page.getByText(/1 check-in is waiting to be sent/)).toBeVisible();
  await expect(page.getByText(/^In at \d{2}:\d{2}$/)).toHaveCount(1);

  // back online: it's sent by itself
  await context.setOffline(false);
  await expect(page.getByText(/waiting to be sent/)).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByText("No connection.")).toHaveCount(0);
  await expect(page.locator("header").getByText("1", { exact: true })).toBeVisible();
});

test("attendance numbers for the club", async ({ page }) => {
  await openClub(page, "Robotics Society");
  await page.getByRole("link", { name: "Attendance" }).click();
  await expect(page.getByText(/^\d+% came$/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "The last 12 months" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Event by event" })).toBeVisible();
});

test("download the attendee list as a spreadsheet", async ({ page }) => {
  await openClub(page, "Robotics Society");
  const panel = await openEvent(page, "Soldering Workshop");
  const [file] = await Promise.all([page.waitForEvent("download"), panel.getByRole("button", { name: "Download list" }).click()]);
  expect(file.suggestedFilename()).toBe("soldering-workshop-attendees.csv");
  const text = (await (await file.createReadStream()).toArray()).map(String).join("");
  const rows = text.replace("﻿", "").trim().split("\r\n");
  expect(rows[0]).toMatch(/^Name,Status,Registered \(.+\),Checked in \(.+\),From outside the workspace$/);
  // 12 places taken, 3 waiting (the demo data)
  expect(rows.filter((r) => r.includes(",Going,"))).toHaveLength(12);
  expect(rows.filter((r) => /,Waitlist \d,/.test(r))).toHaveLength(3);
  expect(text).not.toMatch(/@muster\.test/);
});

test("past events show how the people who came rated them, without names", async ({ page }) => {
  await openClub(page, "Robotics Society");
  await page.getByRole("tab", { name: /^Past/ }).click();
  await page.getByRole("button", { pressed: false }).filter({ hasText: / came/ }).first().click();
  const feedback = page.getByRole("region", { name: "Feedback" });
  await expect(feedback.getByText(/^from \d+ of \d+ asked$/)).toBeVisible();
  await expect(feedback.getByRole("definition").first()).toBeAttached();

  // the link from the email, broken: it says so
  await page.goto("/feedback?token=nope");
  await expect(page.getByRole("heading", { name: "This link doesn't work" })).toBeVisible();
});

test("the activity page says who changed what", async ({ page }) => {
  await openClub(page, "Robotics Society");
  const panel = await openEvent(page, "Soldering Workshop");
  await panel.getByRole("button", { name: "Close registration" }).click();
  await panel.getByRole("button", { name: "Open registration" }).click();
  await expect(panel.getByRole("button", { name: "Close registration" })).toBeVisible();

  await page.getByRole("link", { name: "Activity" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Activity" })).toBeVisible();
  const today = page.getByRole("region", { name: "Today" });
  await expect(today.getByRole("listitem").nth(0)).toHaveText(/Sam Rivera reopened registration for “Soldering Workshop”/);
  await expect(today.getByRole("listitem").nth(1)).toHaveText(/Sam Rivera closed registration for “Soldering Workshop”/);
});

test("price an event, with the workspace's Stripe account ready", async ({ page }) => {
  await page.goto("/o/riverside-uni/settings");
  await expect(page.getByText("Ready to sell tickets in AUD")).toBeVisible();

  await openClub(page, "Robotics Society");
  await page.getByRole("button", { name: "New event" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Name", { exact: true }).fill("Paid Workshop");
  await form.locator("#event-starts").fill(localDateTime(30, 10));
  await form.locator("#event-ends").fill(localDateTime(30, 12));
  await form.getByLabel("Ticket price").fill("12.50");
  await form.getByRole("button", { name: "Publish" }).click();

  const panel = page.getByRole("complementary", { name: "Paid Workshop" });
  await expect(panel.getByRole("definition").filter({ hasText: /^\$12\.50Refunded/ })).toBeVisible();
  await expect(page.getByRole("button").filter({ hasText: "Paid Workshop" }).getByText("$12.50")).toBeVisible();
});

test("message everyone going to an event", async ({ page }) => {
  await openClub(page, "Robotics Society");
  const panel = await openEvent(page, "Robot Wars Viewing");
  await panel.getByRole("button", { name: "Message everyone going" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Subject").fill("Pizza is here");
  await dialog.getByLabel("Message").fill("Grab a slice before the show starts.");
  await dialog.getByRole("button", { name: /^Send to \d+ people$/ }).click();
  await expect(dialog.getByText(/^Sent to \d+ people\.$/)).toBeVisible();
  await expect(dialog.getByRole("region", { name: "Sent already" }).getByText("Pizza is here")).toBeVisible();
});

test("ask a question when people register", async ({ page }) => {
  await openClub(page, "Film Club");
  await page.getByRole("button", { name: "New event" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Name", { exact: true }).fill("Question Night");
  await form.locator("#event-starts").fill(localDateTime(26, 18));
  await form.locator("#event-ends").fill(localDateTime(26, 20));
  await form.getByRole("button", { name: "Add a question" }).click();
  await form.getByLabel("Question 1", { exact: true }).fill("Popcorn?");
  await form.getByLabel("Question 1 answer").selectOption("choice");
  await form.getByLabel("Question 1 choices, one per line").fill("Salted\nSweet");
  await form.getByLabel("Required").check();
  await form.getByRole("button", { name: "Publish" }).click();

  const panel = page.getByRole("complementary", { name: "Question Night" });
  await panel.getByRole("button", { name: "Register" }).click();
  const ask = page.getByRole("dialog");
  await ask.getByText("Sweet", { exact: true }).click();
  await ask.getByRole("button", { name: "Register" }).click();
  await expect(panel.getByText("You’re going.")).toBeVisible();
  await expect(panel.getByRole("region", { name: "Answers" }).getByRole("listitem").filter({ hasText: "Sweet" })).toHaveText(/Sweet\s*1/);
});
