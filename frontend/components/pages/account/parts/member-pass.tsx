import { BadgeCheck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { MyOrganisation } from "@/types";
import { initialsOf } from "../../workspace/org-rail/org-rail.view";

// Punched where the stub tears off: the same ticket as on My tickets.
const notches = [
  "radial-gradient(circle 0.9rem at 0 var(--tear), transparent 98%, #000) left / 51% 100% no-repeat",
  "radial-gradient(circle 0.9rem at 100% var(--tear), transparent 98%, #000) right / 51% 100% no-repeat",
].join(", ");

const since = new Intl.DateTimeFormat("en-AU", {
  month: "short",
  year: "numeric",
});

/**
 * Your Muster pass: who you are on the face (the name follows the form as you
 * type), and what it gets you into on the stub. Not scannable; tickets are.
 */
export function MemberPass({
  name,
  email,
  verified,
  memberSince,
  workspaces,
  upcomingTickets,
}: {
  name: string;
  email: string;
  verified: boolean;
  memberSince: string;
  workspaces: MyOrganisation[] | undefined;
  upcomingTickets: number | undefined;
}) {
  const shown = workspaces?.slice(0, 3) ?? [];
  const more = (workspaces?.length ?? 0) - shown.length;

  return (
    // the shadow sits outside the mask, so it follows the notches
    <div className="w-full max-w-sm [filter:drop-shadow(0_0_0.5px_rgb(26_31_54/0.35))_drop-shadow(0_14px_24px_rgb(47_69_216/0.18))]">
      <figure
        aria-label="Your Muster pass"
        className="overflow-hidden rounded-2xl bg-white [--tear:14.5rem]"
        style={{ mask: notches, WebkitMask: notches }}
      >
        {/* face */}
        <div className="flex h-(--tear) flex-col bg-cobalt px-6 pt-5 pb-6 text-white">
          <div className="flex items-center justify-between">
            <Image
              src="/muster_logo.png"
              alt="Muster"
              width={88}
              height={22}
              className="h-5 w-auto"
            />
            <span className="text-sm text-cobalt-100">Member pass</span>
          </div>
          <span
            aria-hidden
            className="mt-auto grid size-14 place-items-center rounded-full bg-white text-xl font-extrabold text-cobalt font-stretch-70%"
          >
            {initialsOf(name)}
          </span>
          <p className="mt-3 line-clamp-2 text-4xl leading-[0.95] font-extrabold break-words font-stretch-70%">
            {name}
          </p>
          <p className="mt-2 flex min-w-0 items-center gap-1.5 text-sm text-cobalt-100">
            <span className="truncate">{email}</span>
            {verified && (
              <BadgeCheck
                className="size-4 shrink-0 text-white"
                aria-label="Verified"
              />
            )}
          </p>
        </div>

        {/* tear line */}
        <div className="mx-5 border-t-2 border-dashed border-zinc-200" />

        {/* stub */}
        <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-3 px-6 pt-5 pb-6 text-sm">
          <dt className="text-muted-foreground">Member of</dt>
          <dd className="min-w-0 font-medium">
            {workspaces === undefined ? (
              <span className="text-muted-foreground">…</span>
            ) : shown.length === 0 ? (
              <Link
                href="/workspaces"
                className="text-cobalt underline-offset-4 hover:underline"
              >
                Join a workspace
              </Link>
            ) : (
              <ul className="space-y-0.5">
                {shown.map((w) => (
                  <li key={w.orgId} className="truncate">
                    <Link
                      href={`/o/${w.slug}`}
                      className="underline-offset-4 hover:text-cobalt hover:underline"
                    >
                      {w.name}
                    </Link>
                  </li>
                ))}
                {more > 0 && (
                  <li className="font-normal text-muted-foreground">
                    and {more} more
                  </li>
                )}
              </ul>
            )}
          </dd>

          <dt className="text-muted-foreground">Tickets</dt>
          <dd className="font-medium">
            {upcomingTickets === undefined ? (
              <span className="text-muted-foreground">…</span>
            ) : upcomingTickets === 0 ? (
              <span className="font-normal text-muted-foreground">
                None right now
              </span>
            ) : (
              <Link
                href="/tickets"
                className="underline-offset-4 hover:text-cobalt hover:underline"
              >
                {upcomingTickets} to show at the door
              </Link>
            )}
          </dd>

          <dt className="text-muted-foreground">Since</dt>
          <dd className="font-medium">{since.format(new Date(memberSince))}</dd>
        </dl>
      </figure>
    </div>
  );
}
