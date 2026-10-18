import type { Metadata } from "next";
import CheckInContainer from "@/components/pages/workspace/check-in/check-in.container";

export const metadata: Metadata = {
  title: "Check-in",
};

// Rendered only in the browser, once the session is known (RequireSession in
// the layout), and it needs the camera anyway.
export const instant = false;

// The door for one event: scan tickets or find people by name (checkin.scan).
export default function CheckInPage() {
  return <CheckInContainer />;
}
