import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthShell } from "@/components/pages/auth/shared/auth-shell";
import VerifyEmailScreenContainer from "@/components/pages/auth/verify-email/verify-email-screen.container";
import { VerifyingState } from "@/components/pages/auth/verify-email/verify-email-screen.view";

export const metadata: Metadata = {
  title: "Confirm your email",
  // the URL carries a one-time token: keep it out of search results
  robots: { index: false },
};

// The emailed link lands here: /verify-email?token=...
export default function VerifyEmailPage() {
  return (
    <AuthShell>
      {/* the container reads the token from the URL, which only exists in the browser */}
      <Suspense fallback={<VerifyingState />}>
        <VerifyEmailScreenContainer />
      </Suspense>
    </AuthShell>
  );
}
