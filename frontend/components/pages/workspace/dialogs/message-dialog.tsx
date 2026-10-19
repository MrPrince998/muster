"use client";

import { Check, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { Textarea } from "@/components/ui/textarea";
import { asApiError } from "@/lib/api/client";
import type { ClubEvent } from "@/types/event.interface";
import { formatFullDate, formatTime } from "../org-home/parts/format";
import { useEventMessages, useSendEventMessage } from "../services/event.service";

function failure(code: string): string {
  switch (code) {
    case "TOO_MANY_MESSAGES":
      return "That's ten messages today for this event, the most there can be. Try again tomorrow.";
    case "NO_RECIPIENTS":
      return "Nobody is going yet, so there's nobody to message.";
    case "MISSING_PERMISSION":
      return "Only people who can edit this event can message the people going.";
    case "NETWORK_ERROR":
      return "Can't reach Muster. Check your connection, then try again.";
    default:
      return "Couldn't send it. Try again in a moment.";
  }
}

/**
 * Message everyone going to an event (and the waitlist, if you like): a room
 * change, what to bring. Shows what's already been sent, so nobody says it twice.
 */
export function MessageDialog({
  event,
  open,
  onOpenChange,
  timeZone,
}: {
  event: ClubEvent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  timeZone?: string;
}) {
  const history = useEventMessages(event.clubId, event.id, open);
  const send = useSendEventMessage(event.clubId, event.id);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [toWaitlist, setToWaitlist] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<number | null>(null);
  const going = event.registeredCount;
  const people = going + (toWaitlist ? event.waitlistCount : 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const sent = await send.mutateAsync({ subject: subject.trim(), body: body.trim(), toWaitlist });
      setSentTo(sent.recipientCount);
      setSubject("");
      setBody("");
      setToWaitlist(false);
    } catch (err) {
      setError(failure(asApiError(err).code));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setSentTo(null);
          setError(null);
        }
      }}
    >
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-3xl leading-none font-extrabold font-stretch-70%">Message everyone going</DialogTitle>
          <DialogDescription>
            An email to the {going} {going === 1 ? "person" : "people"} going to {event.title}, guests included.
          </DialogDescription>
        </DialogHeader>

        {sentTo !== null && (
          <p role="status" className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
            <Check className="size-4" aria-hidden />
            Sent to {sentTo} {sentTo === 1 ? "person" : "people"}.
          </p>
        )}

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="message-subject" className="text-sm font-medium">
              Subject
            </label>
            <InputGroup className="h-11">
              <InputGroupInput
                id="message-subject"
                value={subject}
                maxLength={150}
                placeholder="Room change"
                onChange={(e) => setSubject(e.target.value)}
              />
            </InputGroup>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="message-body" className="text-sm font-medium">
              Message
            </label>
            <Textarea
              id="message-body"
              rows={5}
              maxLength={5000}
              value={body}
              placeholder="We've moved to Hall C, next door. Same time."
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          {event.waitlistCount > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={toWaitlist}
                onChange={(e) => setToWaitlist(e.target.checked)}
                className="size-4 accent-cobalt"
              />
              Also the {event.waitlistCount} on the waitlist
            </label>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" disabled={!subject.trim() || !body.trim() || send.isPending || people === 0}>
            {send.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
            {send.isPending ? "Sending…" : `Send to ${people} ${people === 1 ? "person" : "people"}`}
          </Button>
        </form>

        {(history.data?.length ?? 0) > 0 && (
          <section aria-label="Sent already" className="space-y-2 border-t pt-4">
            <h3 className="text-sm font-semibold">Sent already</h3>
            <ul className="space-y-2">
              {history.data!.map((m) => (
                <li key={m.id} className="rounded-lg border p-3 text-sm">
                  <p className="font-medium">{m.subject}</p>
                  <p className="text-xs text-muted-foreground">
                    {m.senderName}, {formatFullDate(m.sentAt, timeZone)} at {formatTime(m.sentAt, timeZone)}, to{" "}
                    {m.recipientCount} {m.recipientCount === 1 ? "person" : "people"}
                    {m.toWaitlist ? " (waitlist too)" : ""}
                  </p>
                  <p className="mt-1.5 line-clamp-3 whitespace-pre-line text-muted-foreground">{m.body}</p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}
