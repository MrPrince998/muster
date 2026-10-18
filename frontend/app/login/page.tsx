import type { Metadata } from "next";
import LoginScreenContainer from "@/components/pages/auth/login/login-screen.container";
import { AuthShell } from "@/components/pages/auth/shared/auth-shell";
import { GuestOnly } from "@/components/pages/auth/shared/session-guards";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to manage your clubs, events and check-ins.",
};

export default function LoginPage() {
  return (
    <AuthShell>
      {/* already signed in: straight home */}
      <GuestOnly>
        <LoginScreenContainer />
      </GuestOnly>
    </AuthShell>
  );
}
