"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle, MailCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { asApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { useForgotPassword } from "../services/auth.service";
import { resendVerificationSchema, type ResendVerificationValues } from "../validation/resend-verification.schema";

const linkClass = "font-semibold text-primary underline-offset-4 hover:underline";

/**
 * Ask for a reset link. The answer is the same whether or not the email has
 * an account, so the page can't be used to find out who's signed up.
 */
export default function ForgotPasswordScreen() {
  const forgot = useForgotPassword();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useForm<ResendVerificationValues>({
    resolver: zodResolver(resendVerificationSchema),
    defaultValues: { email: "" },
    mode: "onTouched",
  });
  const {
    register,
    formState: { errors, isSubmitting },
  } = form;

  const onSubmit = form.handleSubmit(async ({ email }) => {
    try {
      await forgot.mutateAsync({ email });
      setSentTo(email);
    } catch (error) {
      const code = asApiError(error).code;
      form.setError("root", {
        message:
          code === "TOO_MANY_REQUESTS"
            ? "Too many attempts. Wait a minute, then try again."
            : code === "NETWORK_ERROR"
              ? "Can't reach Muster. Check your connection, then try again."
              : "Couldn't send the link. Try again in a moment.",
      });
    }
  });

  if (sentTo) {
    return (
      <div className="space-y-8" role="status">
        <header className="space-y-3">
          <span className="grid size-12 place-items-center rounded-full bg-cobalt-50 text-cobalt">
            <MailCheck className="size-6" aria-hidden />
          </span>
          <h1 className="text-5xl leading-none font-extrabold font-stretch-70%">Check your email</h1>
          <p className="text-muted-foreground">
            If an account uses <span className="font-semibold break-all text-foreground">{sentTo}</span>, a link to
            reset its password is on its way. It works once, for 30 minutes.
          </p>
        </header>
        <div className="space-y-3">
          <Link href="/login" className={cn(buttonVariants({ size: "lg" }), "h-11 w-full text-[15px] font-semibold")}>
            Back to sign in
          </Link>
          <p className="text-sm text-muted-foreground">
            Nothing arrived? Check your spam folder, or{" "}
            <button type="button" className={linkClass} onClick={() => setSentTo(null)}>
              try another email
            </button>
            .
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-5xl leading-none font-extrabold font-stretch-70%">Reset your password</h1>
        <p className="text-muted-foreground">Enter your account&rsquo;s email and we&rsquo;ll send you a link to choose a new one.</p>
      </header>

      <form method="post" onSubmit={onSubmit} noValidate className="space-y-6">
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
              autoFocus
              aria-invalid={!!errors.email}
              {...register("email")}
            />
          </InputGroup>
          <FieldError errors={[errors.email]} />
        </Field>

        {errors.root && (
          <p role="alert" className="text-sm text-destructive">
            {errors.root.message}
          </p>
        )}

        <Button type="submit" size="lg" className="h-11 w-full text-[15px] font-semibold" disabled={isSubmitting}>
          {isSubmitting && <LoaderCircle className="animate-spin" aria-hidden />}
          {isSubmitting ? "Sending…" : "Send reset link"}
        </Button>
      </form>

      <p className="text-sm text-muted-foreground">
        Remembered it?{" "}
        <Link href="/login" className={linkClass}>
          Sign in
        </Link>
      </p>
    </div>
  );
}
