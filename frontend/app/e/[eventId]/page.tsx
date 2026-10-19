import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { PublicShell } from "@/components/pages/public/public-shell";
import PublicEventContainer from "@/components/pages/public/event/public-event.container";
import { formatWhen, getPublicEvent, placesLine } from "@/lib/public-event";

// where the share links point; absolute URLs for the previews
const SITE = process.env.NEXT_PUBLIC_SITE_URL!;

/**
 * Link previews: shared in WhatsApp, Slack or iMessage, a public event shows
 * its title, when and where, and a card (opengraph-image.tsx), not a bare
 * URL. Crawlers get these in the <head>; people get them streamed.
 */
export async function generateMetadata({ params }: { params: Promise<{ eventId: string }> }): Promise<Metadata> {
  const { eventId } = await params;
  const event = await getPublicEvent(eventId);
  if (!event) return { title: "Event", robots: { index: false } };

  const description = [
    event.status === "cancelled" ? "Cancelled." : null,
    `${formatWhen(event)}${event.location ? ` at ${event.location}` : ""}.`,
    `${event.clubName}, ${event.workspaceName}.`,
    event.status === "cancelled" ? null : `${placesLine(event)}.`,
  ]
    .filter(Boolean)
    .join(" ");
  return {
    metadataBase: new URL(SITE),
    title: event.title,
    description,
    openGraph: {
      type: "website",
      siteName: "Muster",
      title: event.title,
      description,
      url: `/e/${event.id}`,
    },
    twitter: { card: "summary_large_image", title: event.title, description },
  };
}

// The page itself loads the event in the browser (live place counts).
export const instant = false;

// The metadata reads the request (the event id, live place counts): this says
// that's intended, without holding back the rest of the page (see Next's
// "generateMetadata with Cache Components").
async function AtRequestTime() {
  await connection();
  return null;
}

/** A public event: anyone with the link can see it and get a ticket. */
export default function PublicEventPage() {
  return (
    <PublicShell>
      {/* it reads the address (useParams): Next needs a boundary to build the page */}
      <Suspense>
        <PublicEventContainer />
      </Suspense>
      <Suspense>
        <AtRequestTime />
      </Suspense>
    </PublicShell>
  );
}
