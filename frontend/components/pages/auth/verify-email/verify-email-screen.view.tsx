"use client";

import { CircleAlert, CircleCheck, LoaderCircle, MailCheck, RotateCw } from "lucide-react";
import Link from "next/link";
import type { UseFormReturn } from "react-hook-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";
import type { ResendVerificationValues } from "../validation/resend-verification.schema";
import { isInvite, withNext } from "../shared/session-guards";

export type VerifyStatus =
  | "verifying"
  | "verified"
  // wrong, expired or already used: a new link fixes it
  | "invalid"
  // opened without a token (a link cut short by the mail app)
  | "missing"
  // the same link may still work: offer to try again
  | "rate-limited"
  | "offline"
  | "failed";

interface VerifyEmailScreenViewProps {
  status: VerifyStatus;
  form: UseFormReturn<ResendVerificationValues>;
  onResend: (event?: React.BaseSyntheticEvent) => Promise<void>;
  resent: boolean;
  resendError: string | null;
  onRetry: () => void;
  // where to go once confirmed: the invite link they signed up from
  next: string | null;
}

const primaryButton = cn(buttonVariants({ size: "lg" }), "h-11 w-full text-[15px] font-semibold");

/** The emailed link's landing page. Presentational: all state comes from the container. */
const VerifyEmailScreenView = ({
  status,
  form,
  onResend,
  resent,
  resendError,
  onRetry,
  next,
}: VerifyEmailScreenViewProps) => {
  switch (status) {
    case "verifying":
      return <VerifyingState />;

    case "verified":
      return (
        <Screen
          icon={<CircleCheck className="size-6" aria-hidden />}
          title="Email confirmed"
          body={
            isInvite(next)
              ? "Your account is active. Sign in and you'll go straight to your invite."
              : "Your account is active. Sign in to run your club's events or see your tickets."
          }
        >
          <Link href={withNext("/login", next)} className={primaryButton}>
            {isInvite(next) ? "Continue to your invite" : "Sign in"}
          </Link>
        </Screen>
      );

    case "rate-limited":
    case "offline":
    case "failed":
      return (
        <Screen
          tone="error"
          icon={<CircleAlert className="size-6" aria-hidden />}
          title="Couldn't confirm your email"
          body={
            status === "rate-limited"
              ? "Too many attempts. Wait a minute, then try again."
              : status === "offline"
                ? "Can't reach Muster. Check your internet connection, then try again."
                : "Something went wrong on our side. Try again in a moment."
          }
        >
          <Button type="button" size="lg" className="h-11 w-full text-[15px] font-semibold" onClick={onRetry}>
            <RotateCw aria-hidden />
            Try again
          </Button>
        </Screen>
      );

    case "invalid":
    case "missing":
      return (
        <Screen
          tone="error"
          icon={<CircleAlert className="size-6" aria-hidden />}
          title={status === "missing" ? "This link is incomplete" : "This link doesn't work"}
          body={
            status === "missing"
              ? "Open the link from your email again, or get a new one below."
              : "Confirmation links last 24 hours and work once. Get a new one below."
          }
        >
          {resent ? (
            <ResentNotice />
          ) : (
            <ResendForm form={form} onResend={onResend} resendError={resendError} />
          )}
          <p className="text-sm text-muted-foreground">
            Already confirmed?{" "}
            <Link
              href="/login"
              className="font-semibold text-primary underline-offset-4 hover:underline"
            >
              Sign in
            </Link>
          </p>
        </Screen>
      );
  }
};

/** Shown while the token is checked; also the page's loading fallback. */
export function VerifyingState() {
  return (
    <Screen
      icon={<LoaderCircle className="size-6 animate-spin motion-reduce:animate-none" aria-hidden />}
      title="Confirming your email"
      body="This takes a second."
    />
  );
}

function Screen({
  icon,
  title,
  body,
  tone = "default",
  children,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  tone?: "default" | "error";
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-8">
      {/* announced as it changes: verifying, then the result */}
      <header className="space-y-3" role="status">
        <span
          className={cn(
            "grid size-12 place-items-center rounded-full",
            tone === "error" ? "bg-destructive/10 text-destructive" : "bg-cobalt-50 text-cobalt",
          )}
        >
          {icon}
        </span>
        <h1 className="text-5xl leading-none font-extrabold font-stretch-70%">{title}</h1>
        <p className="text-muted-foreground">{body}</p>
      </header>
      {children && <div className="space-y-6">{children}</div>}
    </div>
  );
}

function ResendForm({
  form,
  onResend,
  resendError,
}: Pick<VerifyEmailScreenViewProps, "form" | "onResend" | "resendError">) {
  const {
    register,
    formState: { errors, isSubmitting },
  } = form;

  return (
    <form method="post" onSubmit={onResend} noValidate className="space-y-4">
      {resendError && (
        <Alert variant="destructive" className="border-destructive/30 bg-destructive/5 px-3 py-3">
          <CircleAlert aria-hidden />
          <AlertTitle>Couldn&rsquo;t send a new link</AlertTitle>
          <AlertDescription>
            {resendError === "TOO_MANY_REQUESTS"
              ? "Too many attempts. Wait a minute, then try again."
              : resendError === "NETWORK_ERROR"
                ? "Can't reach Muster. Check your internet connection, then try again."
                : "Something went wrong on our side. Try again in a moment."}
          </AlertDescription>
        </Alert>
      )}

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

      <Button type="submit" size="lg" className="h-11 w-full text-[15px] font-semibold" disabled={isSubmitting}>
        {isSubmitting ? (
          <>
            <LoaderCircle className="animate-spin" aria-hidden />
            Sending&hellip;
          </>
        ) : (
          "Send a new link"
        )}
      </Button>
    </form>
  );
}

// The API answers the same whether or not the address has an account, so
// this can't promise more than "if".
function ResentNotice() {
  return (
    <Alert className="border-cobalt-200 bg-cobalt-50 px-3 py-3">
      <MailCheck className="text-cobalt" aria-hidden />
      <AlertTitle>Check your inbox</AlertTitle>
      <AlertDescription>
        If that email has an account waiting to be confirmed, a new link is on its way. It can take a
        minute; check your spam folder too.
      </AlertDescription>
    </Alert>
  );
}

export default VerifyEmailScreenView;
