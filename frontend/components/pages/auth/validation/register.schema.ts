import { z } from "zod";

// Mirrors the API's SignUpDto. Unlike sign-in, the password rules are shown
// up front: a new account has to meet them.
export const PASSWORD_MIN_LENGTH = 8;

export const registerSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(100, "Use 100 characters or fewer"),
  email: z.string().trim().min(1, "Enter your email").pipe(z.email("Enter a valid email address")),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
    .max(128, "Use 128 characters or fewer"),
});

export type RegisterValues = z.infer<typeof registerSchema>;
