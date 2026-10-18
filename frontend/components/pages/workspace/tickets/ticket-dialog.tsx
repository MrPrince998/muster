"use client";

import { LoaderCircle, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatFullDate, formatTime, formatTimeRange } from "../org-home/parts/format";
import { useMyTicket } from "../services/ticket.service";

// The notches punched where the stub tears off, the same ticket as everywhere else.
const notches = [
  "radial-gradient(circle 0.75rem at 0 var(--tear), transparent 98%, #000) left / 51% 100% no-repeat",
  "radial-gradient(circle 0.75rem at 100% var(--tear), transparent 98%, #000) right / 51% 100% no-repeat",
].join(", ");

/**
 * Your ticket, as you show it at the door: the event on top, the QR code on
 * the stub. Once scanned, it carries the door's stamp.
 */
export function TicketDialog({
  clubId,
  eventId,
  open,
  onOpenChange,
}: {
  clubId: string;
  eventId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const ticket = useMyTicket(open ? clubId : undefined, open ? eventId : undefined);
  const data = ticket.data;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-1rem)] overflow-y-auto border-0 bg-transparent p-0 shadow-none ring-0 sm:max-w-sm">
        {ticket.isPending ? (
          <div className="grid h-96 place-items-center rounded-3xl bg-background" role="status">
            <LoaderCircle className="size-6 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />
            <DialogTitle className="sr-only">Loading your ticket</DialogTitle>
          </div>
        ) : ticket.isError || !data ? (
          <div className="rounded-3xl bg-background p-6">
            <DialogTitle className="text-2xl font-extrabold font-stretch-70%">
              {ticket.error?.code === "TICKET_NOT_FOUND" ? "No ticket for this event" : "Couldn't load your ticket"}
            </DialogTitle>
            <DialogDescription className="mt-2">
              {ticket.error?.code === "TICKET_NOT_FOUND"
                ? "You're not registered, or you gave your place back."
                : "Check your connection, then try again."}
            </DialogDescription>
            {ticket.error?.code !== "TICKET_NOT_FOUND" && (
              <Button className="mt-4" onClick={() => ticket.refetch()}>
                Try again
              </Button>
            )}
          </div>
        ) : (
          <div
            style={{ mask: notches, WebkitMask: notches, "--tear": "11.5rem" } as React.CSSProperties}
            className="overflow-hidden rounded-3xl bg-background text-ink"
          >
            <div className="h-[11.5rem] p-6">
              <p className="text-sm font-semibold text-cobalt">{data.clubName}</p>
              <DialogTitle className="mt-1 text-4xl leading-none font-extrabold font-stretch-70%">
                {data.eventTitle}
              </DialogTitle>
              <DialogDescription className="mt-3 text-sm text-ink">
                {formatFullDate(data.startsAt)}
                <br />
                {formatTimeRange(data.startsAt, data.endsAt)}
                {data.location && (
                  <>
                    <br />
                    {data.location}
                  </>
                )}
              </DialogDescription>
            </div>

            <div className="mx-6 border-t-2 border-dashed border-zinc-200" />

            <div className="relative flex flex-col items-center p-6 pt-5">
              {data.eventCancelled && (
                <p role="alert" className="mb-4 w-full rounded-lg bg-destructive/5 p-3 text-sm text-destructive">
                  This event was cancelled, so the ticket no longer gets anyone in.
                </p>
              )}
              {/* the API draws it with the qrcode library; it's our own markup, not user input */}
              <div className="relative">
                <div
                  role="img"
                  aria-label={
                    data.checkedInAt ? `Used ticket for ${data.attendeeName}` : `QR code for ${data.attendeeName}'s ticket`
                  }
                  // a used ticket's code doesn't need scanning: faded, so the stamp reads clearly
                  className={cn("size-64 max-w-full [&>svg]:size-full", data.checkedInAt && "opacity-15")}
                  dangerouslySetInnerHTML={{ __html: data.qrSvg }}
                />
                {data.checkedInAt && (
                  // the door's stamp, as on the ticket at sign-in
                  <div className="absolute inset-0 grid place-items-center">
                    <div className="-rotate-12 rounded-xl border-4 border-stamp bg-background/90 px-5 py-2.5 text-center text-stamp">
                      <p className="text-3xl leading-none font-extrabold font-stretch-70%">Checked in</p>
                      <p className="mt-1 text-sm font-semibold tabular-nums">{formatTime(data.checkedInAt)}</p>
                    </div>
                  </div>
                )}
              </div>
              <p className="mt-3 font-semibold">{data.attendeeName}</p>
              <p className="text-xs text-muted-foreground tabular-nums">
                Ticket {data.registrationId.slice(0, 8).toUpperCase()}
              </p>

              {!data.checkedInAt && (
                <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Sun className="size-3.5" aria-hidden />
                  Turn your screen brightness up at the door.
                </p>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
