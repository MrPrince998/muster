import type { Metadata } from "next";
import ForgotPasswordScreen from "@/components/pages/auth/forgot-password/forgot-password-screen";
import { AuthShell } from "@/components/pages/auth/shared/auth-shell";

export const metadata: Metadata = {
  title: "Reset your password",
};

// Open to everyone: forgetting a password is a signed-out problem.
export default function ForgotPasswordPage() {
  return (
    <AuthShell>
      <ForgotPasswordScreen />
    </AuthShell>
  );
}
