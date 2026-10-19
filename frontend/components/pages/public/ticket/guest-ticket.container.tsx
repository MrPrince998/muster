"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { asApiError } from "@/lib/api/client";
import { TicketFace } from "../../workspace/tickets/ticket-face";
import { AddToCalendar } from "../../workspace/shared/add-to-calendar";
import { ConfirmDialog } from "../../workspace/shared/confirm-dialog";
import { publicCalendarUrl, useCancelGuestTicket, useGuestTicket } from "../services/public.service";

/**
 * /t/[token]: a ticket, opened by its own signed token. How a guest (who has
 * no account to sign in to) gets back to their ticket; the emailed link
 * lands here.
 */
export default function GuestTicketContainer() {
  const { token } = useParams<{ token: string }>();
  const ticket = useGuestTicket(decodeURIComponent(token));
  const cancel = useCancelGuestTicket(decodeURIComponent(token));
  const [confirming, setConfirming] = useState(false);
  const [given, setGiven] = useState(false);
  const data = ticket.data;

  if (given) {
    return (
      <Message title="Place given back" body="Thanks for letting someone else have it. Your ticket won't work at the door now." />
    );
  }
  if (ticket.isPending) {
    return (
      <div className="grid min-h-[60svh] place-items-center" role="status">
        <LoaderCircle className="size-6 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />
        <span className="sr-only">Loading your ticket</span>
      </div>
    );
  }
  if (ticket.isError || !data) {
    return ticket.error?.code === "TICKET_NOT_FOUND" || ticket.error?.status === 404 ? (
      <Message title="No ticket here" body="This place was given back, or the link is wrong. If you still want to go, ask for a place again from the event's page." />
    ) : (
      <Message title="Couldn't load your ticket" body="Check your connection, then reload the page." />
    );
  }

  const canGiveBack = !data.checkedInAt && !data.eventCancelled;
  return (
    <div className="mx-auto w-full max-w-sm px-5 py-10">
      <div className="[filter:drop-shadow(0_0_0.5px_rgb(26_31_54/0.3))_drop-shadow(0_14px_24px_rgb(47_69_216/0.16))]">
        <TicketFace ticket={data} />
      </div>
      {!data.eventCancelled && (
        <AddToCalendar
          className="mt-6"
          icsHref={publicCalendarUrl(data.eventId)}
          event={{
            title: data.eventTitle,
            startsAt: data.startsAt,
            endsAt: data.endsAt,
            location: data.location,
            details: `${data.clubName}, ${data.workspaceName}. Your ticket: ${new URL(`/t/${token}`, process.env.NEXT_PUBLIC_SITE_URL)}`,
          }}
        />
      )}
      <p className="mt-6 text-center text-sm text-muted-foreground">
        It&rsquo;s also in your email. Keep this page or that email: either gets you in.
      </p>
      {canGiveBack && (
        <div className="mt-6 text-center">
          <Button variant="ghost" className="text-muted-foreground" onClick={() => setConfirming(true)}>
            Can&rsquo;t make it? Give your place back
          </Button>
        </div>
      )}
      <p className="mt-8 border-t pt-6 text-center text-sm text-muted-foreground">
        Going to more events?{" "}
        <Link href="/signup" className="font-semibold text-cobalt underline-offset-4 hover:underline">
          Create an account
        </Link>{" "}
        with this email to keep your tickets in one place.
      </p>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Give your place back?"
        body={`Your ticket for ${data.eventTitle} stops working, and someone else can have the place.`}
        confirmLabel="Give it back"
        pendingLabel="Giving it back…"
        dismissLabel="Keep my place"
        destructive
        onConfirm={async () => {
          try {
            await cancel.mutateAsync();
            setGiven(true);
            return null;
          } catch (error) {
            const code = asApiError(error).code;
            return code === "ALREADY_CHECKED_IN"
              ? "You've been checked in already, so the place can't be given back."
              : "Couldn't give it back. Try again in a moment.";
          }
        }}
      />
    </div>
  );
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto max-w-md px-5 py-16">
      <h1 className="text-5xl leading-none font-extrabold font-stretch-70%">{title}</h1>
      <p className="mt-3 text-muted-foreground">{body}</p>
    </div>
  );
}
