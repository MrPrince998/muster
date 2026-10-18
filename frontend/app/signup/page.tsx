import type { Metadata } from "next";
import RegisterScreenContainer from "@/components/pages/auth/register/register-screen.container";
import { AuthShell } from "@/components/pages/auth/shared/auth-shell";
import { GuestOnly } from "@/components/pages/auth/shared/session-guards";

export const metadata: Metadata = {
  title: "Create account",
  description: "Create a Muster account to run your club's events and keep your tickets.",
};

export default function SignupPage() {
  return (
    <AuthShell>
      {/* already signed in: straight home */}
      <GuestOnly>
        <RegisterScreenContainer />
      </GuestOnly>
    </AuthShell>
  );
}
