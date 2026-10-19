"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { Textarea } from "@/components/ui/textarea";
import { asApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import type { ClubEvent, SeriesScope } from "@/types/event.interface";
import { useCreateEvent, useUpdateEvent } from "../services/event.service";
import { differsFromDevice, zoneCity } from "@/lib/time-zone";
import { hasLaterInSeries, SeriesScopeChoice } from "../shared/series-scope-choice";
import { eventFormSchema, type EventFormValues, toEventInput, toLocalInput } from "../validation/event.schema";

function messageFor(code: string): string {
  switch (code) {
    case "CAPACITY_BELOW_REGISTERED":
      return "More people are already registered than that. Set the capacity to at least that many.";
    case "EVENT_ENDS_BEFORE_START":
      return "The event has to end after it starts.";
    case "MISSING_PERMISSION":
      return "You don't have permission to do that in this club.";
    case "NETWORK_ERROR":
      return "Can't reach Muster. Check your connection, then try again.";
    default:
      return "Couldn't save the event. Try again in a moment.";
  }
}

const emptyValues: EventFormValues = {
  title: "",
  description: "",
  location: "",
  startsAt: "",
  endsAt: "",
  capacity: "",
  visibility: "members",
  repeatEvery: "none",
  repeatCount: "4",
};

/**
 * New event (save as draft, or publish if you're allowed) or edit an
 * existing one. Pass `event` to edit.
 */
export default function EventFormDialog({
  open,
  onOpenChange,
  clubId,
  clubName,
  orgId,
  canPublish,
  event,
  onSaved,
  timeZone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clubId: string;
  clubName: string;
  orgId: string;
  canPublish: boolean;
  event?: ClubEvent | null;
  onSaved?: (event: ClubEvent) => void;
  // the workspace's: what's typed into the times is its clock
  timeZone?: string;
}) {
  const editing = !!event;
  const createEvent = useCreateEvent(clubId, orgId);
  const updateEvent = useUpdateEvent(clubId, orgId);
  const form = useForm<EventFormValues>({ resolver: zodResolver(eventFormSchema), defaultValues: emptyValues });
  const {
    register,
    control,
    formState: { errors, isSubmitting },
  } = form;
  const repeatEvery = useWatch({ control, name: "repeatEvery" });
  const repeatCount = Number(useWatch({ control, name: "repeatCount" }));
  // editing one of a series: just it, or the rest too
  const inSeries = editing && hasLaterInSeries(event);
  const [scope, setScope] = useState<SeriesScope>("this");
  // each time it opens, back to just this one
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setScope("this");
  }

  // fill the form each time it opens: the event being edited, or blank
  useEffect(() => {
    if (!open) return;
    form.reset(
      event
        ? {
            title: event.title,
            description: event.description ?? "",
            location: event.location ?? "",
            startsAt: toLocalInput(event.startsAt, timeZone),
            endsAt: toLocalInput(event.endsAt, timeZone),
            capacity: event.capacity === null ? "" : String(event.capacity),
            visibility: event.visibility === "public" ? "public" : "members",
            repeatEvery: "none",
            repeatCount: "4",
          }
        : emptyValues,
    );
  }, [open, event, form, timeZone]);

  const save = (publish: boolean) =>
    form.handleSubmit(async (values) => {
      try {
        const saved = editing
          ? await updateEvent.mutateAsync({
              eventId: event!.id,
              ...toEventInput(values, timeZone),
              ...(inSeries && { scope }),
            })
          : await createEvent.mutateAsync({
              ...toEventInput(values, timeZone),
              publish,
              ...(values.repeatEvery !== "none" && {
                repeat: { every: values.repeatEvery, count: Number(values.repeatCount) },
              }),
            });
        onOpenChange(false);
        onSaved?.(saved);
      } catch (error) {
        form.setError("root", { message: messageFor(asApiError(error).code) });
      }
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
        <form onSubmit={save(false)} noValidate className="space-y-5">
          <DialogHeader>
            <DialogTitle className="text-3xl leading-none font-extrabold font-stretch-70%">
              {editing ? "Edit event" : "New event"}
            </DialogTitle>
            <DialogDescription>
              {!editing
                ? `For ${clubName}.`
                : event!.status === "published" && event!.registeredCount > 0
                  ? `Changes show straight away. A new time or place is emailed to the ${event!.registeredCount} ${event!.registeredCount === 1 ? "person" : "people"} registered.`
                  : `Changes show for everyone in ${clubName} straight away.`}
            </DialogDescription>
          </DialogHeader>

          <Field data-invalid={!!errors.title}>
            <FieldLabel htmlFor="event-title">Name</FieldLabel>
            <InputGroup className="h-11">
              <InputGroupInput id="event-title" placeholder="Hack Night" autoFocus aria-invalid={!!errors.title} {...register("title")} />
            </InputGroup>
            <FieldError errors={[errors.title]} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={!!errors.startsAt}>
              <FieldLabel htmlFor="event-starts">Starts</FieldLabel>
              <InputGroup className="h-11">
                <InputGroupInput id="event-starts" type="datetime-local" aria-invalid={!!errors.startsAt} {...register("startsAt")} />
              </InputGroup>
              <FieldError errors={[errors.startsAt]} />
            </Field>
            <Field data-invalid={!!errors.endsAt}>
              <FieldLabel htmlFor="event-ends">Ends</FieldLabel>
              <InputGroup className="h-11">
                <InputGroupInput id="event-ends" type="datetime-local" aria-invalid={!!errors.endsAt} {...register("endsAt")} />
              </InputGroup>
              <FieldError errors={[errors.endsAt]} />
            </Field>
          </div>
          {differsFromDevice(timeZone) && (
            <p className="-mt-2 text-sm text-muted-foreground">
              Times are in {zoneCity(timeZone!)} time, where {clubName} meets, not your device&rsquo;s.
            </p>
          )}

          {!editing && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="event-repeat">Repeats</FieldLabel>
                <select
                  id="event-repeat"
                  className="h-11 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  {...register("repeatEvery")}
                >
                  <option value="none">Doesn&rsquo;t repeat</option>
                  <option value="week">Every week</option>
                  <option value="fortnight">Every fortnight</option>
                  <option value="month">Every month</option>
                </select>
              </Field>
              {repeatEvery !== "none" && (
                <Field data-invalid={!!errors.repeatCount}>
                  <FieldLabel htmlFor="event-repeat-count">How many times</FieldLabel>
                  <InputGroup className="h-11">
                    <InputGroupInput
                      id="event-repeat-count"
                      inputMode="numeric"
                      aria-invalid={!!errors.repeatCount}
                      {...register("repeatCount")}
                    />
                  </InputGroup>
                  <FieldError errors={[errors.repeatCount]} />
                </Field>
              )}
            </div>
          )}
          {!editing && repeatEvery !== "none" && repeatCount >= 2 && repeatCount <= 52 && (
            <p className="-mt-2 text-sm text-muted-foreground">
              Makes {repeatCount} events at the same time of day, each with its own places and tickets.
            </p>
          )}

          <Field data-invalid={!!errors.location}>
            <FieldLabel htmlFor="event-location">Place</FieldLabel>
            <InputGroup className="h-11">
              <InputGroupInput id="event-location" placeholder="Engineering Hall B, or a meeting link" {...register("location")} />
            </InputGroup>
            <FieldError errors={[errors.location]} />
          </Field>

          <Field data-invalid={!!errors.capacity}>
            <FieldLabel htmlFor="event-capacity">Places</FieldLabel>
            <InputGroup className="h-11 sm:max-w-40">
              <InputGroupInput
                id="event-capacity"
                inputMode="numeric"
                placeholder="No limit"
                aria-invalid={!!errors.capacity}
                {...register("capacity")}
              />
            </InputGroup>
            {errors.capacity ? (
              <FieldError errors={[errors.capacity]} />
            ) : (
              <FieldDescription>Leave empty for no limit. Registration closes once it&rsquo;s full.</FieldDescription>
            )}
          </Field>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Who can come</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["members", `${clubName} members`, "Only people in the club can see and register."],
                  ["public", "Anyone with the link", "Open to guests too, not only club members."],
                ] as const
              ).map(([value, label, hint]) => (
                <label
                  key={value}
                  className={cn(
                    "flex cursor-pointer gap-2.5 rounded-lg border p-3 text-sm transition-colors has-checked:border-cobalt has-checked:bg-cobalt-50",
                    "has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                  )}
                >
                  <input type="radio" value={value} className="mt-0.5 accent-cobalt" {...register("visibility")} />
                  <span>
                    <span className="block font-medium">{label}</span>
                    <span className="text-muted-foreground">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <Field data-invalid={!!errors.description}>
            <FieldLabel htmlFor="event-description">About</FieldLabel>
            <Textarea
              id="event-description"
              rows={3}
              placeholder="What happens, what to bring"
              {...register("description")}
            />
            <FieldError errors={[errors.description]} />
          </Field>

          {inSeries && <SeriesScopeChoice value={scope} onChange={setScope} verb="change" />}

          {errors.root && (
            <p role="alert" className="text-sm text-destructive">
              {errors.root.message}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {editing ? (
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <LoaderCircle className="animate-spin" aria-hidden />}
                Save changes
              </Button>
            ) : (
              <>
                <Button type="submit" variant={canPublish ? "outline" : "default"} disabled={isSubmitting}>
                  Save draft
                </Button>
                {canPublish && (
                  <Button type="button" disabled={isSubmitting} onClick={save(true)}>
                    {isSubmitting && <LoaderCircle className="animate-spin" aria-hidden />}
                    Publish
                  </Button>
                )}
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
