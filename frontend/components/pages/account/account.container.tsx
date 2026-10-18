"use client";

import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import { useMe } from "../auth/services/auth.service";
import { useMyOrganisations } from "../workspace/services/organisation.service";
import { useMyTickets } from "../workspace/services/ticket.service";
import { DeleteSection } from "./parts/delete-section";
import { DevicesSection } from "./parts/devices-section";
import { MemberPass } from "./parts/member-pass";
import { PasswordSection } from "./parts/password-section";
import { ProfileSection } from "./parts/profile-section";

/** /account: your pass on the left, what you can change on the right. */
export default function AccountContainer() {
  const me = useMe();

  return (
    <section className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 lg:py-12">
      {me.isPending ? (
        <div className="flex justify-center py-16" role="status">
          <LoaderCircle
            className="size-6 animate-spin text-muted-foreground motion-reduce:animate-none"
            aria-hidden
          />
          <span className="sr-only">Loading your account</span>
        </div>
      ) : me.isError || !me.data ? (
        <p className="text-muted-foreground">
          Couldn&rsquo;t load your account. Check your connection, then reload.
        </p>
      ) : (
        <Account me={me.data} />
      )}
    </section>
  );
}

function Account({
  me,
}: {
  me: NonNullable<ReturnType<typeof useMe>["data"]>;
}) {
  const workspaces = useMyOrganisations();
  const tickets = useMyTickets();
  // the name as it's being typed; blank falls back to the saved one
  const [draft, setDraft] = useState(me.name);
  // the API lists only current tickets; a cancelled event's gets nobody in
  const upcoming = tickets.data?.filter((t) => !t.eventCancelled).length;

  return (
    // phone: heading, pass, settings; desktop: the pass in its own column, beside both
    <div className="grid gap-x-16 gap-y-8 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <h1 className="text-5xl leading-none font-extrabold font-stretch-70% lg:col-start-2 lg:row-start-1">
        Account
      </h1>
      <div className="lg:sticky lg:top-20 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:self-start">
        <MemberPass
          name={draft.trim() || me.name}
          email={me.email}
          verified={!!me.emailVerifiedAt}
          memberSince={me.createdAt}
          workspaces={workspaces.data}
          upcomingTickets={upcoming}
        />
      </div>
      <div className="min-w-0 lg:col-start-2">
        <ProfileSection me={me} onDraft={setDraft} />
        <PasswordSection />
        <DevicesSection />
        <DeleteSection me={me} />
      </div>
    </div>
  );
}
