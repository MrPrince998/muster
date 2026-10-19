import type { Metadata } from "next";
import { Suspense } from "react";
import { PublicShell } from "@/components/pages/public/public-shell";
import UnsubscribeContainer from "@/components/pages/public/unsubscribe/unsubscribe.container";

export const metadata: Metadata = {
  title: "Stop these emails",
  // the address carries the person's link: out of search engines, never sent on
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const instant = false;

// The "stop these" link in a new-event email or digest lands here: /unsubscribe?token=...
export default function UnsubscribePage() {
  return (
    <PublicShell>
      {/* it reads the address (useSearchParams): Next needs a boundary to build the page */}
      <Suspense>
        <UnsubscribeContainer />
      </Suspense>
    </PublicShell>
  );
}
