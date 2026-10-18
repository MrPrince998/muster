import type { Metadata } from "next";
import AccountContainer from "@/components/pages/account/account.container";

export const metadata: Metadata = {
  title: "Account",
};

// Rendered only in the browser, once the session is known (RequireSession in the layout).
export const instant = false;

export default function AccountPage() {
  return <AccountContainer />;
}
