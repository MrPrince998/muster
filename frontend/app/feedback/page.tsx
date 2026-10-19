import type { Metadata } from "next";
import { Suspense } from "react";
import { PublicShell } from "@/components/pages/public/public-shell";
import FeedbackContainer from "@/components/pages/public/feedback/feedback.container";

export const metadata: Metadata = {
  title: "How was it?",
  // the address is the person's own link: out of search engines, never sent on
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const instant = false;

// The "Rate it" link in the email after an event lands here: /feedback?token=...
export default function FeedbackPage() {
  return (
    <PublicShell>
      {/* it reads the address (useSearchParams): Next needs a boundary to build the page */}
      <Suspense>
        <FeedbackContainer />
      </Suspense>
    </PublicShell>
  );
}
