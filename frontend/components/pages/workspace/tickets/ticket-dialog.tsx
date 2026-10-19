"use client";

import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { downloadEventCalendar } from "../services/event.service";
import { useMyTicket } from "../services/ticket.service";
import { AddToCalendar } from "../shared/add-to-calendar";
import { TicketFace } from "./ticket-face";

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
  const ticket = useMyTicket(
    open ? clubId : undefined,
    open ? eventId : undefined,
  );
  const data = ticket.data;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-1rem)] overflow-y-auto border-0 bg-transparent p-0 shadow-none ring-0 sm:max-w-sm">
        {ticket.isPending ? (
          <div
            className="grid h-96 place-items-center rounded-3xl bg-background"
            role="status"
          >
            <LoaderCircle
              className="size-6 animate-spin text-muted-foreground motion-reduce:animate-none"
              aria-hidden
            />
            <DialogTitle className="sr-only">Loading your ticket</DialogTitle>
          </div>
        ) : ticket.isError || !data ? (
          <div className="rounded-3xl bg-background p-6">
            <DialogTitle className="text-2xl font-extrabold font-stretch-70%">
              {ticket.error?.code === "TICKET_NOT_FOUND"
                ? "No ticket for this event"
                : "Couldn't load your ticket"}
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
          <>
            <TicketFace
              ticket={data}
              Title={DialogTitle}
              Description={DialogDescription}
            />
            {!data.eventCancelled && (
              <AddToCalendar
                className="mt-3 [&>button]:bg-background"
                onDownload={() => downloadEventCalendar(data.clubId, data.eventId, data.eventTitle)}
                event={{
                  title: data.eventTitle,
                  startsAt: data.startsAt,
                  endsAt: data.endsAt,
                  location: data.location,
                  details: `${data.clubName}, ${data.workspaceName}`,
                }}
              />
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
