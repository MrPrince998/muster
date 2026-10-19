"use client";

import { LoaderCircle, MailX } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { asApiError, request } from "@/lib/api/client";

/**
 * /unsubscribe?token=...: stops a club's new-event emails, or a workspace's
 * weekly digest, without signing in. Asks first, so a mail scanner opening
 * the link stops nothing.
 */
export default function UnsubscribeContainer() {
  const token = useSearchParams().get("token") ?? "";
  const [state, setState] = useState<{ status: "ask" | "working" | "failed" } | { status: "done"; stopped: string }>({
    status: "ask",
  });

  const stop = async () => {
    setState({ status: "working" });
    try {
      const res = await request<{ stopped: string }>({ method: "post", url: "/public/event-emails/off", data: { token } });
      setState({ status: "done", stopped: res.stopped });
    } catch (error) {
      setState({ status: asApiError(error).code === "INVALID_TOKEN" ? "failed" : "ask" });
    }
  };

  return (
    <div className="mx-auto max-w-md px-5 py-16">
      <span className="grid size-12 place-items-center rounded-full bg-cobalt-50 text-cobalt">
        <MailX className="size-6" aria-hidden />
      </span>
      {state.status === "done" ? (
        <>
          <h1 className="mt-5 text-5xl leading-none font-extrabold font-stretch-70%">Stopped</h1>
          <p className="mt-3 text-muted-foreground">
            {state.stopped} won&rsquo;t come any more. You can turn them back on from the club&rsquo;s page, under Email me.
          </p>
        </>
      ) : state.status === "failed" || !token ? (
        <>
          <h1 className="mt-5 text-5xl leading-none font-extrabold font-stretch-70%">This link doesn&rsquo;t work</h1>
          <p className="mt-3 text-muted-foreground">
            It may be incomplete. Use the link in the email again, or{" "}
            <Link href="/login" className="font-semibold text-cobalt underline-offset-4 hover:underline">
              sign in
            </Link>{" "}
            and change it on the club&rsquo;s page, under Email me.
          </p>
        </>
      ) : (
        <>
          <h1 className="mt-5 text-5xl leading-none font-extrabold font-stretch-70%">Stop these emails?</h1>
          <p className="mt-3 text-muted-foreground">
            You&rsquo;ll stop getting the emails this link came in. Tickets and reminders for events you&rsquo;re going
            to still arrive.
          </p>
          <Button size="lg" className="mt-6 h-11 font-semibold" onClick={stop} disabled={state.status === "working"}>
            {state.status === "working" && <LoaderCircle className="animate-spin" aria-hidden />}
            Stop these emails
          </Button>
        </>
      )}
    </div>
  );
}
