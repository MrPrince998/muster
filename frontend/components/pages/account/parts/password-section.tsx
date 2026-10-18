"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Eye, EyeOff, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { asApiError } from "@/lib/api/client";
import { useChangePassword } from "../../auth/services/auth.service";
import { PASSWORD_MIN_LENGTH } from "../../auth/validation/register.schema";
import {
  changePasswordSchema,
  type ChangePasswordValues,
} from "../../auth/validation/password.schema";
import { AccountRow, actionSize } from "./account-row";

const empty: ChangePasswordValues = {
  currentPassword: "",
  newPassword: "",
  confirm: "",
};

/** Change your password; every other device is signed out, this one stays in. */
export function PasswordSection() {
  const change = useChangePassword();
  const [shown, setShown] = useState(false);
  const [saved, setSaved] = useState(false);
  const form = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: empty,
    mode: "onTouched",
  });
  const {
    register,
    formState: { errors, isSubmitting },
  } = form;
  const type = shown ? "text" : "password";

  const onSubmit = form.handleSubmit(
    async ({ currentPassword, newPassword }) => {
      setSaved(false);
      try {
        await change.mutateAsync({ currentPassword, newPassword });
        form.reset(empty);
        setSaved(true);
      } catch (error) {
        const code = asApiError(error).code;
        if (code === "INVALID_PASSWORD") {
          form.setError(
            "currentPassword",
            { message: "That's not your current password" },
            { shouldFocus: true },
          );
          return;
        }
        form.setError("root", {
          message:
            code === "TOO_MANY_REQUESTS"
              ? "Too many attempts. Wait a minute, then try again."
              : code === "NETWORK_ERROR"
                ? "Can't reach Muster. Check your connection, then try again."
                : "Couldn't change your password. Try again in a moment.",
        });
      }
    },
  );

  return (
    <AccountRow
      id="password-heading"
      title="Password"
      description="Changing it signs you out on your other devices. This one stays signed in."
    >
      <form method="post" onSubmit={onSubmit} noValidate className="space-y-5">
        <Field data-invalid={!!errors.currentPassword}>
          <div className="flex items-center justify-between">
            <FieldLabel htmlFor="current-password">Current password</FieldLabel>
            <Link
              href="/forgot-password"
              className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Forgot it?
            </Link>
          </div>
          <InputGroup className="h-11">
            <InputGroupInput
              id="current-password"
              type={type}
              autoComplete="current-password"
              aria-invalid={!!errors.currentPassword}
              {...register("currentPassword")}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                aria-label={shown ? "Hide passwords" : "Show passwords"}
                aria-pressed={shown}
                onClick={() => setShown((value) => !value)}
              >
                {shown ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <FieldError errors={[errors.currentPassword]} />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field data-invalid={!!errors.newPassword}>
            <FieldLabel htmlFor="new-password">New password</FieldLabel>
            <InputGroup className="h-11">
              <InputGroupInput
                id="new-password"
                type={type}
                autoComplete="new-password"
                aria-invalid={!!errors.newPassword}
                {...register("newPassword")}
              />
            </InputGroup>
            {errors.newPassword ? (
              <FieldError errors={[errors.newPassword]} />
            ) : (
              <FieldDescription>
                At least {PASSWORD_MIN_LENGTH} characters.
              </FieldDescription>
            )}
          </Field>
          <Field data-invalid={!!errors.confirm}>
            <FieldLabel htmlFor="confirm-password">Type it again</FieldLabel>
            <InputGroup className="h-11">
              <InputGroupInput
                id="confirm-password"
                type={type}
                autoComplete="new-password"
                aria-invalid={!!errors.confirm}
                {...register("confirm")}
              />
            </InputGroup>
            <FieldError errors={[errors.confirm]} />
          </Field>
        </div>

        {errors.root && (
          <p role="alert" className="text-sm text-destructive">
            {errors.root.message}
          </p>
        )}
        <div className="flex items-center gap-3">
          <Button type="submit" className={actionSize} disabled={isSubmitting}>
            {isSubmitting && (
              <LoaderCircle className="animate-spin" aria-hidden />
            )}
            {isSubmitting ? "Saving…" : "Change password"}
          </Button>
          <p
            role="status"
            className="flex items-center gap-1.5 text-sm text-muted-foreground"
          >
            {saved && (
              <>
                <Check className="size-4 text-cobalt" aria-hidden />
                Changed. Your other devices were signed out.
              </>
            )}
          </p>
        </div>
      </form>
    </AccountRow>
  );
}
