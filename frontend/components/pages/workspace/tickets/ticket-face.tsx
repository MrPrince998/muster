import { Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TicketWithCode } from "@/types";
import {
  formatFullDate,
  formatTime,
  formatTimeRange,
} from "../org-home/parts/format";

// The notches punched where the stub tears off, the same ticket as everywhere else.
const notches = [
  "radial-gradient(circle 0.75rem at 0 var(--tear), transparent 98%, #000) left / 51% 100% no-repeat",
  "radial-gradient(circle 0.75rem at 100% var(--tear), transparent 98%, #000) right / 51% 100% no-repeat",
].join(", ");

type TextPart = React.ComponentType<{
  className?: string;
  children?: React.ReactNode;
}>;
const Heading: TextPart = (props) => <h1 {...props} />;
const Paragraph: TextPart = (props) => <p {...props} />;

/**
 * A ticket as you show it at the door: the event on top, the QR code on the
 * stub; once scanned, it carries the door's stamp. Shared by My tickets (in a
 * dialog, which passes its own Title and Description for screen readers) and
 * a guest's ticket page.
 */
export function TicketFace({
  ticket,
  Title = Heading,
  Description = Paragraph,
}: {
  ticket: TicketWithCode;
  Title?: TextPart;
  Description?: TextPart;
}) {
  return (
    <div
      style={
        {
          mask: notches,
          WebkitMask: notches,
          "--tear": "11.5rem",
        } as React.CSSProperties
      }
      className="overflow-hidden rounded-3xl bg-background text-ink"
    >
      <div className="h-[11.5rem] p-6">
        <p className="text-sm font-semibold text-cobalt">{ticket.clubName}</p>
        <Title className="mt-1 text-4xl leading-none font-extrabold font-stretch-70%">
          {ticket.eventTitle}
        </Title>
        <Description className="mt-3 text-sm text-ink">
          {formatFullDate(ticket.startsAt)}
          <br />
          {formatTimeRange(ticket.startsAt, ticket.endsAt)}
          {ticket.location && (
            <>
              <br />
              {ticket.location}
            </>
          )}
        </Description>
      </div>

      <div className="mx-6 border-t-2 border-dashed border-zinc-200" />

      <div className="relative flex flex-col items-center p-6 pt-5">
        {ticket.eventCancelled && (
          <p
            role="alert"
            className="mb-4 w-full rounded-lg bg-destructive/5 p-3 text-sm text-destructive"
          >
            This event was cancelled, so the ticket no longer gets anyone in.
          </p>
        )}
        {/* the API draws it with the qrcode library; it's our own markup, not user input */}
        <div className="relative">
          <div
            role="img"
            aria-label={
              ticket.checkedInAt
                ? `Used ticket for ${ticket.attendeeName}`
                : `QR code for ${ticket.attendeeName}'s ticket`
            }
            // a used ticket's code doesn't need scanning: faded, so the stamp reads clearly
            className={cn(
              "size-64 max-w-full [&>svg]:size-full",
              ticket.checkedInAt && "opacity-15",
            )}
            dangerouslySetInnerHTML={{ __html: ticket.qrSvg }}
          />
          {ticket.checkedInAt && (
            // the door's stamp, as on the ticket at sign-in
            <div className="absolute inset-0 grid place-items-center">
              <div className="-rotate-12 rounded-xl border-4 border-stamp bg-background/90 px-5 py-2.5 text-center text-stamp">
                <p className="text-3xl leading-none font-extrabold font-stretch-70%">
                  Checked in
                </p>
                <p className="mt-1 text-sm font-semibold tabular-nums">
                  {formatTime(ticket.checkedInAt)}
                </p>
              </div>
            </div>
          )}
        </div>
        <p className="mt-3 font-semibold">{ticket.attendeeName}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          Ticket {ticket.registrationId.slice(0, 8).toUpperCase()}
        </p>

        {!ticket.checkedInAt && (
          <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Sun className="size-3.5" aria-hidden />
            Turn your screen brightness up at the door.
          </p>
        )}
      </div>
    </div>
  );
}
