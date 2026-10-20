"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ImagePlus, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiUrl, resizeImage } from "@/lib/image";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
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
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Textarea } from "@/components/ui/textarea";
import { asApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import type { ClubEvent, SeriesScope } from "@/types/event.interface";
import { eventsKey, removeCover, uploadCover, useCreateEvent, useUpdateEvent } from "../services/event.service";
import { differsFromDevice, zoneCity } from "@/lib/time-zone";
import { hasLaterInSeries, SeriesScopeChoice } from "../shared/series-scope-choice";
import { usePaymentStatus } from "../services/payment.service";
import { parseMoney } from "@/lib/money";
import { eventFormSchema, type EventFormValues, toEventInput, toLocalInput } from "../validation/event.schema";

function messageFor(code: string): string {
  switch (code) {
    case "CAPACITY_BELOW_REGISTERED":
      return "More people are already registered than that. Set the capacity to at least that many.";
    case "EVENT_ENDS_BEFORE_START":
      return "The event has to end after it starts.";
    case "MISSING_PERMISSION":
      return "You don't have permission to do that in this club.";
    case "QUESTION_NEEDS_CHOICES":
      return "A choose-one question needs at least two choices.";
    case "TOO_MANY_QUESTIONS":
      return "Up to five questions.";
    case "TICKET_TYPE_HAS_SALES":
      return "People already have one of the tickets you removed. Keep it, and set an end date for its sales instead.";
    case "TICKET_NAME_TAKEN":
      return "Two tickets have the same name. Give each its own.";
    case "PAYMENTS_NOT_SET_UP":
      return "This workspace can't take payments yet. Connect Stripe in Settings, or make the event free.";
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
  tickets: [],
  refundCutoffHours: "48",
  questions: [],
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
  // paid tickets only once the workspace's Stripe account can take payments (or the event has some already)
  const payments = usePaymentStatus(orgId);
  const canPrice = !!payments.data?.ready || !!event?.price;
  const currency = (event?.price?.currency ?? payments.data?.currency ?? "").toUpperCase();
  const createEvent = useCreateEvent(clubId, orgId);
  const updateEvent = useUpdateEvent(clubId, orgId);
  const form = useForm<EventFormValues>({ resolver: zodResolver(eventFormSchema), defaultValues: emptyValues });
  const {
    register,
    control,
    formState: { errors, isSubmitting },
  } = form;
  const repeatEvery = useWatch({ control, name: "repeatEvery" });
  const questions = useFieldArray({ control, name: "questions" });
  const tickets = useFieldArray({ control, name: "tickets" });
  const ticketValues = useWatch({ control, name: "tickets" });
  const anyPaid = (ticketValues ?? []).some((t) => (parseMoney(t.price) ?? 0) > 0);
  const questionKinds = useWatch({ control, name: "questions" });
  const repeatCount = Number(useWatch({ control, name: "repeatCount" }));
  // editing one of a series: just it, or the rest too
  const inSeries = editing && hasLaterInSeries(event);
  const [scope, setScope] = useState<SeriesScope>("this");
  // each time it opens, back to just this one
  // a new cover image waiting to upload once the event's saved, or the current one going
  const [cover, setCover] = useState<{ file: Blob | null; removed: boolean }>({ file: null, removed: false });
  const [preparing, setPreparing] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);
  const preview = useMemo(() => (cover.file ? URL.createObjectURL(cover.file) : null), [cover.file]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);
  const shownCover = preview ?? (!cover.removed && event?.coverUrl ? apiUrl(event.coverUrl) : null);
  const queryClient = useQueryClient();
  const coverInput = useRef<HTMLInputElement>(null);

  const chooseCover = async (file: File | undefined) => {
    if (!file) return;
    setCoverError(null);
    setPreparing(true);
    try {
      const image = await resizeImage(file);
      if (image.size > 2 * 1024 * 1024) throw new Error("too large");
      setCover({ file: image, removed: false });
    } catch {
      setCoverError("That image couldn't be used. Try a JPEG, PNG or WebP photo.");
    } finally {
      setPreparing(false);
    }
  };

  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setScope("this");
      setCover({ file: null, removed: false });
    }
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
            tickets: event.ticketTypes.map((t) => ({
              id: t.id,
              name: t.name,
              price: t.priceCents ? (t.priceCents / 100).toFixed(2) : "",
              capacity: t.capacity === null ? "" : String(t.capacity),
              membersOnly: t.membersOnly,
              salesEnd: t.salesEndAt ? toLocalInput(t.salesEndAt, timeZone) : "",
            })),
            refundCutoffHours: String(event.refundCutoffHours),
            questions: event.questions.map((q) => ({
              id: q.id,
              label: q.label,
              kind: q.kind,
              options: q.options.join("\n"),
              required: q.required,
            })),
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
        // the image goes once the event exists; the lists then show it
        try {
          if (cover.file) await uploadCover(clubId, saved.id, cover.file);
          else if (cover.removed && event?.coverUrl) await removeCover(clubId, saved.id);
          if (cover.file || cover.removed) await queryClient.invalidateQueries({ queryKey: eventsKey(clubId) });
        } catch {
          // the event is saved either way; editing it again can add the image
          if (editing) {
            form.setError("root", { message: "Saved, but the image didn't upload. Try choosing it again." });
            return;
          }
        }
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

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Tickets</legend>
            <p className="text-sm text-muted-foreground">
              {tickets.fields.length === 0
                ? "None: free for everyone. Add tickets to charge, or to offer different kinds (members, early bird)."
                : "Leave a price empty for a free ticket."}
            </p>
            {tickets.fields.map((field, index) => {
              const fieldErrors = errors.tickets?.[index];
              const paid = (parseMoney(ticketValues?.[index]?.price ?? "") ?? 0) > 0;
              return (
                <div key={field.id} className="space-y-2 rounded-lg border p-3">
                  <div className="flex gap-2">
                    <InputGroup className="h-10 flex-1">
                      <InputGroupInput
                        aria-label={`Ticket ${index + 1} name`}
                        placeholder="General"
                        aria-invalid={!!fieldErrors?.name}
                        {...register(`tickets.${index}.name`)}
                      />
                    </InputGroup>
                    <InputGroup className="h-10 w-32">
                      <InputGroupInput
                        aria-label={`Ticket ${index + 1} price`}
                        inputMode="decimal"
                        placeholder="Free"
                        aria-invalid={!!fieldErrors?.price}
                        {...register(`tickets.${index}.price`)}
                      />
                      {currency && (
                        <InputGroupAddon align="inline-end">
                          <InputGroupText>{currency}</InputGroupText>
                        </InputGroupAddon>
                      )}
                    </InputGroup>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ticket ${index + 1}`}
                      onClick={() => tickets.remove(index)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                  <FieldError errors={[fieldErrors?.name, fieldErrors?.price]} />
                  {paid && !canPrice && (
                    <p className="text-sm text-destructive">
                      Connect Stripe in Settings to sell paid tickets, or make this one free.
                    </p>
                  )}
                  <div className="grid gap-2 sm:grid-cols-2">
                    <span className="text-xs text-muted-foreground sm:col-start-1">How many (optional)</span>
                    <span className="text-xs text-muted-foreground max-sm:hidden">On sale until (optional)</span>
                    <InputGroup className="h-10">
                      <InputGroupInput
                        aria-label={`Ticket ${index + 1} limit`}
                        inputMode="numeric"
                        placeholder="No limit"
                        aria-invalid={!!fieldErrors?.capacity}
                        {...register(`tickets.${index}.capacity`)}
                      />
                    </InputGroup>
                    <span className="text-xs text-muted-foreground sm:hidden">On sale until (optional)</span>
                    <InputGroup className="h-10">
                      <InputGroupInput
                        aria-label={`Ticket ${index + 1} on sale until`}
                        type="datetime-local"
                        {...register(`tickets.${index}.salesEnd`)}
                      />
                    </InputGroup>
                  </div>
                  <FieldError errors={[fieldErrors?.capacity]} />
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="size-4 accent-cobalt" {...register(`tickets.${index}.membersOnly`)} />
                    {clubName} members only
                  </label>
                </div>
              );
            })}
            {tickets.fields.length < 10 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  tickets.append({
                    name: tickets.fields.length === 0 ? "General" : "",
                    price: "",
                    capacity: "",
                    membersOnly: false,
                    salesEnd: "",
                  })
                }
              >
                <Plus aria-hidden />
                Add a ticket
              </Button>
            )}
          </fieldset>

          {anyPaid && (
            <Field data-invalid={!!errors.refundCutoffHours}>
              <FieldLabel htmlFor="event-refund">Refunds until</FieldLabel>
              <InputGroup className="h-11 sm:max-w-56">
                <InputGroupInput
                  id="event-refund"
                  inputMode="numeric"
                  aria-invalid={!!errors.refundCutoffHours}
                  {...register("refundCutoffHours")}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>hours before</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
              {errors.refundCutoffHours ? (
                <FieldError errors={[errors.refundCutoffHours]} />
              ) : (
                <FieldDescription>A paid ticket given back before then is refunded in full.</FieldDescription>
              )}
            </Field>
          )}

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

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Questions for people taking a place</legend>
            <p className="text-sm text-muted-foreground">
              Dietary needs, T-shirt sizes: asked when they register. Answers are in the attendee list and spreadsheet.
            </p>
            {questions.fields.map((field, index) => {
              const fieldErrors = errors.questions?.[index];
              return (
                <div key={field.id} className="space-y-2 rounded-lg border p-3">
                  <div className="flex gap-2">
                    <InputGroup className="h-10 flex-1">
                      <InputGroupInput
                        aria-label={`Question ${index + 1}`}
                        placeholder="Dietary needs"
                        aria-invalid={!!fieldErrors?.label}
                        {...register(`questions.${index}.label`)}
                      />
                    </InputGroup>
                    <select
                      aria-label={`Question ${index + 1} answer`}
                      className="h-10 rounded-lg border border-input bg-transparent px-2 text-sm"
                      {...register(`questions.${index}.kind`)}
                    >
                      <option value="text">Short answer</option>
                      <option value="choice">Choose one</option>
                    </select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove question ${index + 1}`}
                      onClick={() => questions.remove(index)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                  <FieldError errors={[fieldErrors?.label]} />
                  {questionKinds?.[index]?.kind === "choice" && (
                    <>
                      <Textarea
                        aria-label={`Question ${index + 1} choices, one per line`}
                        rows={3}
                        placeholder={"None\nVegetarian\nVegan"}
                        {...register(`questions.${index}.options`)}
                      />
                      <FieldError errors={[fieldErrors?.options]} />
                    </>
                  )}
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="size-4 accent-cobalt" {...register(`questions.${index}.required`)} />
                    Required
                  </label>
                </div>
              );
            })}
            {questions.fields.length < 5 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => questions.append({ label: "", kind: "text", options: "", required: false })}
              >
                <Plus aria-hidden />
                Add a question
              </Button>
            )}
          </fieldset>

          <div className="space-y-2">
            <p className="text-sm font-medium">Cover image</p>
            {shownCover ? (
              <div className="space-y-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- a preview, or the API's file: nothing for next/image to optimise */}
                <img src={shownCover} alt="" className="aspect-[16/9] w-full rounded-lg border object-cover" />
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => coverInput.current?.click()}>
                    <ImagePlus aria-hidden />
                    Change
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={() => setCover({ file: null, removed: true })}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => coverInput.current?.click()}
                disabled={preparing}
                className="flex w-full flex-col items-center gap-1 rounded-lg border border-dashed p-5 text-sm text-muted-foreground transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                {preparing ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : <ImagePlus className="size-5" aria-hidden />}
                {preparing ? "Preparing the image…" : "Add a cover image"}
                <span className="text-xs">Shown on the event, its public page and link previews</span>
              </button>
            )}
            <input
              ref={coverInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              aria-label="Cover image file"
              tabIndex={-1}
              onChange={(e) => {
                void chooseCover(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {coverError && <p className="text-sm text-destructive">{coverError}</p>}
          </div>

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
