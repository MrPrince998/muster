"use client";

import { Bell, BellOff, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type EventEmails, useEventEmails, useSetEventEmails } from "../../services/event-emails.service";

const CHOICES: { value: EventEmails; label: string; hint: string }[] = [
  { value: "instant", label: "As they're published", hint: "An email for each new event" },
  { value: "weekly", label: "Weekly digest", hint: "Monday: the next two weeks" },
  { value: "off", label: "Off", hint: "Check the app yourself" },
];

/** "Email me": whether, and how, this club's new events reach your inbox. */
export function EventEmailsMenu({ clubId }: { clubId: string }) {
  const current = useEventEmails(clubId);
  const set = useSetEventEmails(clubId);
  const value = set.isPending ? set.variables?.eventEmails : current.data?.eventEmails;
  const on = value && value !== "off";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="lg" variant="outline" className="h-11" disabled={current.isPending} />}>
        {set.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : on ? <Bell aria-hidden /> : <BellOff aria-hidden />}
        {value === "instant" ? "Emails: new events" : value === "weekly" ? "Emails: weekly" : "Email me"}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Email me about new events</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(next) => void set.mutateAsync({ eventEmails: next as EventEmails }).catch(() => undefined)}
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
