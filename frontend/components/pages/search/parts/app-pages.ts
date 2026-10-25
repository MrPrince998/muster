import type { MyOrganisation } from "@/types/organisation.interface";
import { abilitiesFor } from "../../workspace/org-shell/workspace-context";

/** One of the app's own pages, offered in search so people can jump straight there. */
export interface PageHit {
  key: string;
  label: string;
  detail: string;
  href: string;
}

interface PageDef {
  label: string;
  // other words people might type for it
  words: string[];
  detail: string;
}

// pages that aren't in a workspace
const APP_PAGES: (PageDef & { href: string })[] = [
  { label: "My tickets", href: "/tickets", detail: "Your tickets and QR codes", words: ["tickets", "passes", "qr", "registrations", "going"] },
  { label: "Your workspaces", href: "/workspaces", detail: "Switch, create or join a workspace", words: ["workspaces", "home", "switch", "create", "new workspace", "join"] },
  { label: "Account", href: "/account", detail: "Your name, email and password", words: ["profile", "password", "email", "name", "sign out", "log out", "delete account"] },
  { label: "Help", href: "/help", detail: "Answers to common questions", words: ["faq", "support", "questions", "how"] },
];

// a workspace's pages, each for the roles that can use it
const WORKSPACE_PAGES: (PageDef & { path: string; allowed: (can: ReturnType<typeof abilitiesFor>) => boolean })[] = [
  { label: "Events", path: "", detail: "Upcoming, past and draft events", words: ["events", "calendar", "upcoming", "past", "drafts"], allowed: () => true },
  { label: "Browse clubs", path: "/clubs", detail: "Find clubs to join", words: ["clubs", "join club", "directory", "find"], allowed: () => true },
  { label: "Members", path: "/members", detail: "People, roles and invite links", words: ["people", "members", "invite", "invite links", "roles"], allowed: (can) => can.seeMembers },
  { label: "Join requests", path: "/join-requests", detail: "People asking to join", words: ["requests", "approve", "pending", "waiting"], allowed: (can) => can.reviewJoinRequests },
  { label: "Activity", path: "/activity", detail: "Who changed what", words: ["activity", "audit", "log", "history", "changes"], allowed: (can) => can.changeSettings },
  { label: "Workspace settings", path: "/settings", detail: "Name, time zone, joining and payments", words: ["settings", "time zone", "payments", "stripe", "join policy", "delete workspace", "rename"], allowed: (can) => can.changeSettings },
];

const MAX = 5;

// how well a page fits the query, 0 when it doesn't: its name first, then its other words
function fit(page: PageDef, q: string): number {
  const label = page.label.toLowerCase();
  if (label.startsWith(q)) return 1;
  if (label.split(/\s+/).some((word) => word.startsWith(q))) return 0.9;
  if (page.words.some((word) => word.startsWith(q))) return 0.8;
  if (page.words.some((word) => word.split(/\s+/).some((part) => part.startsWith(q)))) return 0.7;
  return 0;
}

/**
 * The pages matching what's typed, best first: the app's own, then each
 * workspace's that your role can open (the one you're in first). Local and
 * instant: no request.
 */
export function matchPages(query: string, organisations: MyOrganisation[], currentSlug: string | null): PageHit[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [];
  const ordered = [...organisations].sort((a, b) => Number(b.slug === currentSlug) - Number(a.slug === currentSlug));

  const hits: (PageHit & { score: number })[] = APP_PAGES.map((page) => ({
    key: `page:${page.href}`,
    label: page.label,
    detail: page.detail,
    href: page.href,
    score: fit(page, q),
  }));
  for (const [i, org] of ordered.entries()) {
    const can = abilitiesFor(org.role);
    for (const page of WORKSPACE_PAGES.filter((p) => p.allowed(can))) {
      const href = `/o/${org.slug}${page.path}`;
      hits.push({
        key: `page:${href}`,
        label: page.label,
        detail: `${org.name}: ${page.detail.charAt(0).toLowerCase()}${page.detail.slice(1)}`,
        href,
        // the same page in another workspace ranks just below this one's
        score: fit(page, q) - i * 0.01,
      });
    }
  }
  return hits
    .filter((hit) => hit.score > 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX)
    .map(({ key, label, detail, href }) => ({ key, label, detail, href }));
}
