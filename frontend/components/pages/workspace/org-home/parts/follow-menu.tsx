"use client";

import { Bell, CalendarSync, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SubscribeDialog } from "../../dialogs/subscribe-dialog";
import { type EventEmails, useEventEmails, useSetEventEmails } from "../../services/event-emails.service";

const CHOICES: { value: EventEmails; label: string; hint: string }[] = [
  { value: "instant", label: "As they're published", hint: "An email for each new event" },
  { value: "weekly", label: "Weekly digest", hint: "Monday: the next two weeks" },
  { value: "off", label: "Off", hint: "Check the app yourself" },
];

/**
 * "Follow": how this club's new events reach you. By email (each one, or
 * Monday's digest) and in your own calendar (a feed it keeps up to date).
 */
export function FollowMenu({ clubId, clubName }: { clubId: string; clubName: string }) {
  const current = useEventEmails(clubId);
  const set = useSetEventEmails(clubId);
  const [subscribing, setSubscribing] = useState(false);
  const value = set.isPending ? set.variables?.eventEmails : current.data?.eventEmails;
  const on = value && value !== "off";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button size="lg" variant="outline" className="h-11" />}>
          {set.isPending ? (
            <LoaderCircle className="animate-spin" aria-hidden />
          ) : (
            <Bell className={on ? "fill-current" : undefined} aria-hidden />
          )}
          {on ? "Following" : "Follow"}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Email me about new events</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={value ?? "off"}
              onValueChange={(next) =>
                void set.mutateAsync({ eventEmails: next as EventEmails }).catch(() => undefined)
              }
            >
              {CHOICES.map((choice) => (
                <DropdownMenuRadioItem key={choice.value} value={choice.value} className="py-1.5">
                  <span>
                    <span className="block font-medium">{choice.label}</span>
                    <span className="block text-xs text-muted-foreground">{choice.hint}</span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          {set.isError && (
            <p role="alert" className="px-2 py-1.5 text-xs text-destructive">
              Couldn&rsquo;t save that. Try again.
            </p>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setSubscribing(true)}>
            <CalendarSync aria-hidden />
            Add to my calendar…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <SubscribeDialog clubId={clubId} clubName={clubName} open={subscribing} onOpenChange={setSubscribing} />
    </>
  );
}
