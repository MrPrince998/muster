import type { Metadata } from "next";
import HelpView from "@/components/pages/help/help.view";

export const metadata: Metadata = {
  title: "Help",
};

// Rendered only in the browser, once the session is known (RequireSession in the layout).
export const instant = false;

export default function HelpPage() {
  return <HelpView />;
}
