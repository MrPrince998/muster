import { test as base, expect, type Locator, type Page } from "@playwright/test";

/** The seeded demo account (backend src/database/seed.ts). */
export const DEMO = { email: "demo@muster.test", password: "muster-demo-2026", name: "Sam Rivera" };
export const RIVERSIDE = "riverside-uni";
const API = process.env.API_URL ?? "http://localhost:5001";

/**
 * Signs in through the API with the browser's own cookie jar, so the page
 * starts with a session of its own (the refresh cookie) and no sign-in steps.
 */
export async function signIn(page: Page, who = DEMO): Promise<void> {
  const res = await page.request.post(`${API}/auth/signin`, { data: { email: who.email, password: who.password } });
  expect(res.ok(), `sign-in for ${who.email}: ${res.status()}`).toBeTruthy();
}

/** Tests that start signed in as the demo user. */
export const test = base.extend({
  // (Playwright calls this callback `use`; named otherwise so the React hooks lint doesn't mistake it for a hook)
  page: async ({ page }, provide) => {
    await signIn(page);
    await provide(page);
  },
});
export { expect };

/** Opens a club's events in Riverside University. */
export async function openClub(page: Page, club: string): Promise<void> {
  await page.goto(`/o/${RIVERSIDE}`);
  // the sidebar link reads "Robotics Society 2 upcoming events"; match on the name it starts with
  const name = new RegExp(`^${club.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`);
  await page.getByRole("link", { name }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: club })).toBeVisible();
}

/** Opens an event's panel from the club's list (switching tab if needed); returns the panel. */
export async function openEvent(page: Page, title: string, tab?: "Upcoming" | "Past" | "Drafts"): Promise<Locator> {
  if (tab) await page.getByRole("tab", { name: new RegExp(`^${tab}`) }).click();
  await page.getByRole("button", { pressed: false }).filter({ hasText: title }).first().click();
  const panel = page.getByRole("complementary", { name: title });
  await expect(panel).toBeVisible();
  return panel;
}

/** A date-time for <input type="datetime-local">, some days from now, in the browser's zone. */
export function localDateTime(daysFromNow: number, hour: number, minute = 0): string {
  const date = new Date(Date.now() + daysFromNow * 86_400_000);
  date.setHours(hour, minute, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
