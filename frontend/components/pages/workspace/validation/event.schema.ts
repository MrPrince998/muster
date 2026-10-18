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
  })
  .refine((values) => !values.startsAt || !values.endsAt || new Date(values.endsAt) > new Date(values.startsAt), {
    path: ["endsAt"],
    message: "It has to end after it starts",
  });

export type EventFormValues = z.infer<typeof eventFormSchema>;

/** ISO -> the value a datetime-local input wants, in local time: "2026-10-24T18:30". */
export function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The form's values as the API takes them. */
export function toEventInput(values: EventFormValues) {
  return {
    title: values.title,
    description: values.description,
    location: values.location,
    startsAt: new Date(values.startsAt).toISOString(),
    endsAt: new Date(values.endsAt).toISOString(),
    capacity: values.capacity === "" ? null : Number(values.capacity),
    visibility: values.visibility,
  };
}

export const createClubSchema = z.object({
  name: z.string().trim().min(1, "Give the club a name").max(100, "Use 100 characters or fewer"),
  description: z.string().trim().max(500, "Use 500 characters or fewer"),
});
export type CreateClubValues = z.infer<typeof createClubSchema>;
