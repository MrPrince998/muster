"use client";

import {
  CircleAlert,
  Eye,
  EyeOff,
  LoaderCircle,
  MailCheck,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
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
import { cn } from "@/lib/utils";
import {
  PASSWORD_MIN_LENGTH,
  type RegisterValues,
} from "../validation/register.schema";
import { isInvite, withNext } from "../shared/session-guards";

export type RegisterNotice =
  | { kind: "error"; title: string; body: string }
  // the email already has an account: point to sign in
  | { kind: "taken"; title: string; body: string };

type ResendState = "idle" | "sending" | "sent";

interface RegisterScreenViewProps {
  form: UseFormReturn<RegisterValues>;
  onSubmit: (event?: React.BaseSyntheticEvent) => Promise<void>;
  notice: RegisterNotice | null;
  sentTo: string | null;
  resend: ResendState;
  onResendVerification: () => void;
  onChangeEmail: () => void;
  // the page to return to (an invite link)
  next: string | null;
}

/** The sign-up form, then the "check your email" step. Presentational. */
const RegisterScreenView = ({
  form,
  onSubmit,
  notice,
  sentTo,
  resend,
  onResendVerification,
  onChangeEmail,
  next,
}: RegisterScreenViewProps) => {
  const [showPassword, setShowPassword] = useState(false);
  const {
    register,
    formState: { errors, isSubmitting },
  } = form;

  if (sentTo) {
    return (
      <CheckEmail
        invite={isInvite(next)}
        next={next}
        sentTo={sentTo}
        resend={resend}
        onResend={onResendVerification}
        onChangeEmail={onChangeEmail}
      />
    );
  }

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-5xl leading-none font-extrabold font-stretch-70%">
          Create your account
        </h1>
        <p className="text-muted-foreground">
          Run your club&rsquo;s events, or keep all your tickets in one place.
        </p>
      </header>

      {notice && <NoticeBanner notice={notice} />}

      <form method="post" onSubmit={onSubmit} noValidate className="space-y-6">
        <FieldGroup className="gap-5">
          <Field data-invalid={!!errors.name}>
            <FieldLabel htmlFor="name">Full name</FieldLabel>
            <InputGroup className="h-11">
              <InputGroupInput
                id="name"
                autoComplete="name"
                placeholder="Ada Lovelace"
                aria-invalid={!!errors.name}
                aria-describedby={errors.name ? "name-error" : undefined}
                {...register("name")}
              />
            </InputGroup>
            <FieldError id="name-error" errors={[errors.name]} />
          </Field>

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
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <InputGroup className="h-11">
              <InputGroupInput
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Choose a password"
                aria-invalid={!!errors.password}
                aria-describedby={
                  errors.password ? "password-error" : "password-hint"
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
            {errors.password ? (
              <FieldError id="password-error" errors={[errors.password]} />
            ) : (
              <FieldDescription id="password-hint">
                At least {PASSWORD_MIN_LENGTH} characters. A short phrase works
                well.
              </FieldDescription>
            )}
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
              Creating account&hellip;
            </>
          ) : (
            "Create account"
          )}
        </Button>

        <p className="text-sm text-muted-foreground">
          Registered for an event before? Use the same email and your tickets
          move into your account.
        </p>
      </form>

      <p className="text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          href={withNext("/login", next)}
          className="font-semibold text-primary underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
};

/** After sign-up: the account exists but stays locked until the link is opened. */
function CheckEmail({
  invite,
  next,
  sentTo,
  resend,
  onResend,
  onChangeEmail,
}: {
  // they signed up from an invite link, which the email leads back to
  invite: boolean;
  next: string | null;
  sentTo: string;
  resend: ResendState;
  onResend: () => void;
  onChangeEmail: () => void;
}) {
  return (
    <div className="space-y-8" role="status">
      <header className="space-y-3">
        <span className="grid size-12 place-items-center rounded-full bg-cobalt-50 text-cobalt">
          <MailCheck className="size-6" aria-hidden />
        </span>
        <h1 className="text-5xl leading-none font-extrabold font-stretch-70%">
          Check your email
        </h1>
        <p className="text-muted-foreground">
          We sent a confirmation link to{" "}
          <span className="font-semibold break-all text-foreground">
            {sentTo}
          </span>
          .{" "}
          {invite
            ? "Open it to activate your account; it brings you back to your invite, on any device."
            : "Open it to activate your account, then sign in."}
        </p>
      </header>

      <div className="space-y-3">
        <Link
          href={withNext("/login", next)}
          className={cn(
            buttonVariants({ size: "lg" }),
            "h-11 w-full text-[15px] font-semibold",
          )}
        >
          Go to sign in
        </Link>
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="h-11 w-full text-[15px]"
          onClick={onResend}
          disabled={resend !== "idle"}
        >
          {resend === "sending" && (
            <LoaderCircle className="animate-spin" aria-hidden />
          )}
          {resend === "idle" && "Resend the email"}
          {resend === "sending" && "Sending…"}
          {resend === "sent" && "Sent again. Check your spam folder too"}
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Wrong address?{" "}
        <button
          type="button"
          onClick={onChangeEmail}
          className="font-semibold text-primary underline-offset-4 hover:underline"
        >
          Change your email
        </button>
      </p>
    </div>
  );
}

function NoticeBanner({ notice }: { notice: RegisterNotice }) {
  return (
    <Alert
      variant="destructive"
      className="border-destructive/30 bg-destructive/5 px-3 py-3"
    >
      <CircleAlert aria-hidden />
      <AlertTitle>{notice.title}</AlertTitle>
      {/* <AlertDescription>
        <p>{notice.body}</p>
      </AlertDescription> */}
    </Alert>
  );
}

export default RegisterScreenView;
