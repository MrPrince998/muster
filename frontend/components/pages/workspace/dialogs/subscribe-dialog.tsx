"use client";

import { Check, Copy, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";
import { clubFeedLinks, useCalendarFeedToken, useResetCalendarFeed } from "../services/feed.service";

/**
 * The club's events in your own calendar, kept up to date by the calendar
 * app (new events appear, moved ones move, cancelled ones are struck out).
 */
export function SubscribeDialog({
  clubId,
  clubName,
  open,
  onOpenChange: setOpen,
}: {
  clubId: string;
  clubName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const feed = useCalendarFeedToken(open);
  const reset = useResetCalendarFeed();
  const links = feed.data ? clubFeedLinks(feed.data.token, clubId) : null;

  const copy = async () => {
    if (!links) return;
    try {
      await navigator.clipboard.writeText(links.https);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked: the link is on screen to copy by hand
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setConfirmingReset(false);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-3xl leading-none font-extrabold font-stretch-70%">
              {clubName} in your calendar
            </DialogTitle>
            <DialogDescription>
              Subscribe once: new events appear by themselves, changed ones update, and cancelled ones are marked
              cancelled.
            </DialogDescription>
          </DialogHeader>

          {feed.isPending ? (
            <div className="grid h-32 place-items-center" role="status">
              <LoaderCircle className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />
              <span className="sr-only">Getting your link</span>
            </div>
          ) : !links ? (
            <p role="alert" className="text-sm text-destructive">
              Couldn&rsquo;t get your link. Check your connection, then try again.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-2">
                <a href={links.webcal} className={cn(buttonVariants({ size: "lg" }), "h-11 font-semibold")}>
                  Apple or Outlook
                </a>
                <a
                  href={links.google}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(buttonVariants({ size: "lg", variant: "outline" }), "h-11")}
                >
                  Google Calendar
                </a>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="feed-link" className="text-sm font-medium">
                  Or copy the link into any calendar app
                </label>
                <div className="flex gap-2">
                  <InputGroup className="h-10 min-w-0 flex-1">
                    <InputGroupInput id="feed-link" readOnly value={links.https} onFocus={(e) => e.target.select()} />
                  </InputGroup>
                  <Button type="button" variant="outline" onClick={copy} aria-live="polite">
                    {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>
              <div className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                <p>
                  This link is yours: anyone who has it sees {clubName}&rsquo;s events. If it gets out, reset it; your
                  calendars then need the new link.
                </p>
                {confirmingReset ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={reset.isPending}
                      onClick={async () => {
                        try {
                          await reset.mutateAsync();
                        } finally {
                          setConfirmingReset(false);
                        }
                      }}
                    >
                      {reset.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
                      Reset every link
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmingReset(false)}>
                      Keep it
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" variant="link" className="mt-1 h-auto px-0" onClick={() => setConfirmingReset(true)}>
                    Reset link
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
