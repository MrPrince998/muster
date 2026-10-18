"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { onSessionEnd } from "@/lib/auth/access-token";
import { makeQueryClient } from "./query-client";

/** One QueryClient per browser tab, created on first render. */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(makeQueryClient);
  const router = useRouter();

  // the session ended mid-use: drop everything cached for that user and send
  // them to sign in
  useEffect(
    () =>
      onSessionEnd(() => {
        client.clear();
        router.replace("/login");
      }),
    [client, router],
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
