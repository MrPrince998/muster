import type { Metadata } from "next";
import { Suspense } from "react";
import ConfirmPlaceContainer from "@/components/pages/public/confirm/confirm-place.container";
import { PublicShell } from "@/components/pages/public/public-shell";

export const metadata: Metadata = {
  title: "Confirm your place",
  // a one-time link: keep it out of search engines
  robots: { index: false, follow: false },
};

export const instant = false;

export default function ConfirmPlacePage() {
  return (
    <PublicShell>
      {/* it reads ?token= from the address */}
      <Suspense>
        <ConfirmPlaceContainer />
      </Suspense>
    </PublicShell>
  );
}
