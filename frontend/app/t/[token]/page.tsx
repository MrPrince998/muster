import type { Metadata } from "next";
import { Suspense } from "react";
import { PublicShell } from "@/components/pages/public/public-shell";
import GuestTicketContainer from "@/components/pages/public/ticket/guest-ticket.container";

export const metadata: Metadata = {
  title: "Your ticket",
  // the address is the ticket: keep it out of search engines, and don't send it on as a referrer
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const instant = false;

export default function GuestTicketPage() {
  return (
    <PublicShell>
      {/* it reads the address (useParams): Next needs a boundary to build the page */}
      <Suspense>
        <GuestTicketContainer />
      </Suspense>
    </PublicShell>
  );
}
