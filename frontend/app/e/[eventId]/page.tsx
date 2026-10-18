import type { Metadata } from "next";
import PublicEventContainer from "@/components/pages/public/event/public-event.container";
import { PublicShell } from "@/components/pages/public/public-shell";

export const metadata: Metadata = {
  title: "Event",
};

// Fetched in the browser: the event (and how many places are left) changes.
export const instant = false;

/** A public event: anyone with the link can see it and get a ticket. */
export default function PublicEventPage() {
  return (
    <PublicShell>
      <PublicEventContainer />
    </PublicShell>
  );
}
