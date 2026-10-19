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

  // a calendar file anyone can have, no account needed
  await guest.getByRole("button", { name: "Add to calendar" }).click();
  const ics = await guest.getByRole("menuitem", { name: "Apple, Outlook and others" }).getAttribute("href");
  const file = await guest.request.get(ics!);
  expect(file.headers()["content-type"]).toBe("text/calendar; charset=utf-8");
  expect(await file.text()).toContain("SUMMARY:Robot Wars Viewing");
  await guest.keyboard.press("Escape");

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

test("a shared link shows a preview: title, when and where, and a card", async ({ page, request }) => {
  await openClub(page, "Robotics Society");
  const panel = await openEvent(page, "Robot Wars Viewing");
  const href = (await panel.getByRole("link", { name: "Open page" }).getAttribute("href"))!;

  // what Slack, WhatsApp and the like fetch: the tags are in the <head>, not streamed
  const html = await (await request.get(href, { headers: { "User-Agent": "Slackbot-LinkExpanding 1.0" } })).text();
  const head = html.split("</head>")[0];
  expect(head).toContain('<meta property="og:title" content="Robot Wars Viewing"/>');
  expect(head).toMatch(/<meta property="og:description" content="[^"]*Lecture Theatre 1\. Robotics Society, Riverside University\. \d+ places left\."/);
  expect(head).toContain('<meta name="twitter:card" content="summary_large_image"/>');

  const image = head.match(/<meta property="og:image" content="([^"]+)"/)![1];
  const card = await request.get(new URL(image).pathname + new URL(image).search);
  expect(card.status()).toBe(200);
  expect(card.headers()["content-type"]).toBe("image/png");
  expect((await card.body()).length).toBeGreaterThan(10_000);
});

test("a public paid event shows its price, and guests pay after confirming", async ({ page, browser }) => {
  await openClub(page, "Robotics Society");
  const panel = await openEvent(page, "Robotics Gala Dinner");
  const href = (await panel.getByRole("link", { name: "Open page" }).getAttribute("href"))!;

  const stranger = await browser.newContext({ storageState: undefined });
  const guest = await stranger.newPage();
  await guest.goto(href);
  const card = guest.getByRole("complementary", { name: "Get a ticket" });
  await expect(card.getByText("$45.00, with a QR ticket for the door")).toBeVisible();
  await card.getByLabel("Your name").fill("Paula Payer");
  await card.getByLabel("Email").fill("paula.payer@example.test");
  await card.getByRole("button", { name: "Buy a ticket for $45.00" }).click();
  await expect(card.getByText(/Open it to pay; your place is held while you do/)).toBeVisible();

  // back from Stripe, paid
  await guest.goto(`${href}?paid=1`);
  await expect(card.getByText("Payment received")).toBeVisible();
  await stranger.close();
});
