import type { Metadata } from "next";
import { Suspense } from "react";
import MyTicketsContainer from "@/components/pages/workspace/tickets/my-tickets.container";

export const metadata: Metadata = {
  title: "My tickets",
};

// Rendered only in the browser, once the session is known (RequireSession in the layout).
export const instant = false;

// Your tickets across every workspace. Ticket emails link here.
export default function TicketsPage() {
  return (
    // it reads ?ticket= (the link in a ticket email), which only the browser knows
    <Suspense>
      <MyTicketsContainer />
    </Suspense>
  );
}
