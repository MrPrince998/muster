import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Home",
};

// redirecting to login page
export default function Home() {
  redirect("/login");
}
