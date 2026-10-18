import { z } from "zod";

export const guestPlaceSchema = z.object({
  name: z.string().trim().min(1, "Your name goes on the ticket").max(100, "100 characters at most"),
  email: z.string().trim().min(1, "Where should we send the ticket?").email("That doesn't look like an email address"),
});

export type GuestPlaceValues = z.infer<typeof guestPlaceSchema>;
