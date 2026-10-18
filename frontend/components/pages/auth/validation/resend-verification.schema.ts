import { z } from "zod";

// Asking for a new confirmation link: just the address it goes to.
export const resendVerificationSchema = z.object({
  email: z.string().trim().min(1, "Enter your email").pipe(z.email("Enter a valid email address")),
});

export type ResendVerificationValues = z.infer<typeof resendVerificationSchema>;
