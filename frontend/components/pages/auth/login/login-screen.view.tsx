"use client";

import { CircleAlert, Eye, EyeOff, LoaderCircle, MailCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { isInvite, withNext } from "../shared/session-guards";
import type { LoginValues } from "../validation/login.schema";

export type LoginNotice =
  | { kind: "error"; title: string; body: string }
  // signed in correctly, but the email is not confirmed yet
  | { kind: "unverified"; title: string; body: string };

interface LoginScreenViewProps {
  form: UseFormReturn<LoginValues>;
  onSubmit: (event?: React.BaseSyntheticEvent) => Promise<void>;
  notice: LoginNotice | null;
  resend: "idle" | "sending" | "sent";
  onResendVerification: () => void;
  // the page to return to (an invite link), carried to sign up
  next: string | null;
}

/** The sign-in form. Presentational: all state comes from the container. */
const LoginScreenView = ({
  form,
  onSubmit,
  notice,
  resend,
  onResendVerification,
  next,
}: LoginScreenViewProps) => {
  const [showPassword, setShowPassword] = useState(false);
  const {
    register,
    formState: { errors, isSubmitting },
  } = form;

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-5xl leading-none font-extrabold font-stretch-70%">Sign in</h1>
        <p className="text-muted-foreground">
          {isInvite(next)
            ? "Sign in to accept your invite. New here? Create an account first; you'll come back to it."
            : "Manage your clubs, events and check-ins."}
        </p>
      </header>

      {notice && (
        <NoticeBanner
          notice={notice}
          resend={resend}
          onResend={onResendVerification}
        />
      )}

      <form method="post" onSubmit={onSubmit} noValidate className="space-y-6">
        <FieldGroup className="gap-5">
          <Field data-invalid={!!errors.email}>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <InputGroup className="h-11">
              <InputGroupInput
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="you@university.edu"
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? "email-error" : undefined}
                {...register("email")}
              />
            </InputGroup>
            <FieldError id="email-error" errors={[errors.email]} />
          </Field>

          <Field data-invalid={!!errors.password}>
            <div className="flex items-center justify-between">
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Link
                href="/forgot-password"
                className="text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <InputGroup className="h-11">
              <InputGroupInput
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Your password"
                aria-invalid={!!errors.password}
                aria-describedby={
                  errors.password ? "password-error" : undefined
                }
                {...register("password")}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-xs"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((shown) => !shown)}
                >
                  {showPassword ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            <FieldError id="password-error" errors={[errors.password]} />
          </Field>
        </FieldGroup>

        <Button
          type="submit"
          size="lg"
          className="h-11 w-full text-[15px] font-semibold"
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <>
              <LoaderCircle className="animate-spin" aria-hidden />
              Signing in&hellip;
            </>
          ) : (
            "Sign in"
          )}
        </Button>
      </form>

      <p className="text-sm text-muted-foreground">
        New to Muster?{" "}
        <Link
          href={withNext("/signup", next)}
          className="font-semibold text-primary underline-offset-4 hover:underline"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
};

function NoticeBanner({
  notice,
  resend,
  onResend,
}: {
  notice: LoginNotice;
  resend: LoginScreenViewProps["resend"];
  onResend: () => void;
}) {
  if (notice.kind === "unverified") {
    return (
      <Alert className="border-amber-500/30 bg-amber-500/5 px-3 py-3">
        <MailCheck className="text-amber-600 dark:text-amber-400" aria-hidden />
        <AlertTitle>{notice.title}</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>{notice.body}</p>
          {resend === "sent" ? (
            <p className="font-medium text-foreground">
              Sent. Check your inbox (and spam folder).
            </p>
          ) : (
            <Button
              type="button"
              variant="link"
              className="h-auto p-0 font-medium"
              onClick={onResend}
              disabled={resend === "sending"}
            >
              {resend === "sending"
                ? "Sending…"
                : "Resend the confirmation email"}
            </Button>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert
      variant="destructive"
      className="border-destructive/30 bg-destructive/5 px-3 py-3"
    >
      <CircleAlert aria-hidden />
      <AlertTitle>{notice.title}</AlertTitle>
      <AlertDescription>{notice.body}</AlertDescription>
    </Alert>
  );
}

export default LoginScreenView;
