/** Something picked from search, remembered so it's one keypress away next time. */
export interface RecentPick {
  key: string;
  kind: "workspace" | "club" | "event" | "person" | "page";
  label: string;
  detail: string;
  href: string;
}

const KEY = "muster:recent-search";
const MAX = 5;

// per browser and best effort: storage can be missing or full
export function readRecent(): RecentPick[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as RecentPick[]).slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function rememberPick(pick: RecentPick): void {
  try {
    const rest = readRecent().filter((p) => p.key !== pick.key);
    localStorage.setItem(KEY, JSON.stringify([pick, ...rest].slice(0, MAX)));
  } catch {
    // not remembered; search still works
  }
}

export function forgetRecent(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to do
  }
}
