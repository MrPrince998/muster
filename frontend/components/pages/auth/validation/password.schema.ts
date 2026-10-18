import { z } from "zod";
import { PASSWORD_MIN_LENGTH } from "./register.schema";

const newPassword = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(128, "Use 128 characters or fewer");

// Mirrors ResetPasswordDto, plus typing it twice: there's no old password to fall back on.
export const resetPasswordSchema = z
  .object({ password: newPassword, confirm: z.string() })
  .refine((values) => values.password === values.confirm, { path: ["confirm"], message: "The passwords don't match" });
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

// Mirrors ChangePasswordDto.
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword,
    confirm: z.string(),
  })
  .refine((values) => values.newPassword === values.confirm, { path: ["confirm"], message: "The passwords don't match" })
  .refine((values) => values.newPassword !== values.currentPassword, {
    path: ["newPassword"],
    message: "Choose a password you aren't already using",
  });
export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

export const profileSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(100, "Use 100 characters or fewer"),
});
export type ProfileValues = z.infer<typeof profileSchema>;
