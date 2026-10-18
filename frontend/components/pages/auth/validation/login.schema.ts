import { z } from "zod";

// Mirrors the API's SignInDto: no minimum password length here, so a short
// password fails as "incorrect" rather than revealing the password rules.
export const loginSchema = z.object({
  email: z.string().trim().min(1, "Enter your email").pipe(z.email("Enter a valid email address")),
  password: z.string().min(1, "Enter your password").max(128, "That password is too long"),
});

export type LoginValues = z.infer<typeof loginSchema>;
