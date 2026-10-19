import { parseMoney } from "@/lib/money";
import { isoToWallClock, wallClockToIso } from "@/lib/time-zone";
import { z } from "zod";

// Mirrors the API's CreateEventDto. Dates come from <input type="datetime-local">
// (local time, no zone) and are sent as ISO with the browser's zone.
export const eventFormSchema = z
  .object({
    title: z.string().trim().min(1, "Give the event a name").max(200, "Use 200 characters or fewer"),
    description: z.string().trim().max(5000, "Use 5000 characters or fewer"),
    location: z.string().trim().max(255, "Use 255 characters or fewer"),
    startsAt: z.string().min(1, "Choose when it starts"),
    endsAt: z.string().min(1, "Choose when it ends"),
    // empty means no limit
    capacity: z
      .string()
      .trim()
      .refine((value) => value === "" || (/^\d+$/.test(value) && Number(value) >= 1), "Enter a whole number, 1 or more"),
    visibility: z.enum(["members", "public"]),
    // the ways in; none: free for everyone
    tickets: z
      .array(
        z.object({
          id: z.string().optional(),
          name: z.string().trim().min(1, "Name the ticket").max(60, "Use 60 characters or fewer"),
          // as typed ("15", "15.50"); empty or 0: free
          price: z
            .string()
            .trim()
            .refine(
              (value) => value === "" || value === "0" || (parseMoney(value) ?? 0) >= 50,
              "Free, or at least 0.50",
            ),
          // empty: no limit of its own
          capacity: z
            .string()
            .trim()
            .refine((value) => value === "" || (/^\d+$/.test(value) && Number(value) >= 1), "A whole number, 1 or more"),
          membersOnly: z.boolean(),
          // datetime-local; empty: on sale until the event
          salesEnd: z.string(),
        }),
      )
      .max(10),
    refundCutoffHours: z
      .string()
      .trim()
      .refine((value) => /^\d+$/.test(value) && Number(value) <= 720, "Enter whole hours, up to 720"),
    // what to ask people taking a place; a choice question's options, one per line
    questions: z
      .array(
        z
          .object({
            id: z.string().optional(),
            label: z.string().trim().min(1, "Write the question").max(150, "Use 150 characters or fewer"),
            kind: z.enum(["text", "choice"]),
            options: z.string(),
            required: z.boolean(),
          })
          .refine((q) => q.kind === "text" || choiceList(q.options).length >= 2, {
            path: ["options"],
            message: "Give at least two choices, one per line",
          }),
      )
      .max(5),
    // new events only: how often it repeats, and how many in all
    repeatEvery: z.enum(["none", "week", "fortnight", "month"]),
    repeatCount: z.string().trim(),
  })
  .refine(
    (values) =>
      values.repeatEvery === "none" ||
      (/^\d+$/.test(values.repeatCount) && Number(values.repeatCount) >= 2 && Number(values.repeatCount) <= 52),
    { path: ["repeatCount"], message: "Between 2 and 52 times" },
  )
  .refine((values) => !values.startsAt || !values.endsAt || new Date(values.endsAt) > new Date(values.startsAt), {
    path: ["endsAt"],
    message: "It has to end after it starts",
  });

export type EventFormValues = z.infer<typeof eventFormSchema>;

/** A choice question's options, as typed: one per line (or comma-separated), no blanks or repeats. */
export function choiceList(text: string): string[] {
  return [...new Set(text.split(/[\n,]/).map((o) => o.trim()).filter(Boolean))];
}

/**
 * ISO -> the value a datetime-local input wants, on the clock in `zone` (the
 * workspace's): "2026-10-24T18:30". Without a zone, the device's.
 */
export function toLocalInput(iso: string, zone?: string): string {
  if (zone) return isoToWallClock(iso, zone);
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The form's values as the API takes them; the times read on the clock in `zone`. */
export function toEventInput(values: EventFormValues, zone?: string) {
  const instant = (local: string) => (zone ? wallClockToIso(local, zone) : new Date(local).toISOString());
  return {
    title: values.title,
    description: values.description,
    location: values.location,
    startsAt: instant(values.startsAt),
    endsAt: instant(values.endsAt),
    capacity: values.capacity === "" ? null : Number(values.capacity),
    visibility: values.visibility,
    ticketTypes: values.tickets.map((t) => ({
      ...(t.id && { id: t.id }),
      name: t.name,
      priceCents: t.price === "" ? 0 : (parseMoney(t.price) ?? 0),
      capacity: t.capacity === "" ? null : Number(t.capacity),
      membersOnly: t.membersOnly,
      salesEndAt: t.salesEnd ? instant(t.salesEnd) : null,
    })),
    refundCutoffHours: Number(values.refundCutoffHours),
    questions: values.questions.map((q) => ({
      ...(q.id && { id: q.id }),
      label: q.label,
      kind: q.kind,
      ...(q.kind === "choice" && { options: choiceList(q.options) }),
      required: q.required,
    })),
  };
}

export const createClubSchema = z.object({
  name: z.string().trim().min(1, "Give the club a name").max(100, "Use 100 characters or fewer"),
  description: z.string().trim().max(500, "Use 500 characters or fewer"),
});
export type CreateClubValues = z.infer<typeof createClubSchema>;
