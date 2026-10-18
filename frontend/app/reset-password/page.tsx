import type { Metadata } from "next";
import { Suspense } from "react";
import ResetPasswordScreen from "@/components/pages/auth/reset-password/reset-password-screen";
import { AuthShell } from "@/components/pages/auth/shared/auth-shell";

export const metadata: Metadata = {
  title: "Choose a new password",
  // the URL carries a one-time token: keep it out of search results
  robots: { index: false },
};

// The emailed link lands here: /reset-password?token=...
export default function ResetPasswordPage() {
  return (
    <AuthShell>
      {/* the token is in the URL, which only the browser has */}
      <Suspense>
        <ResetPasswordScreen />
      </Suspense>
    </AuthShell>
  );
}
