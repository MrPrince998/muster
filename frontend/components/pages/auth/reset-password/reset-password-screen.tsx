"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CircleAlert, CircleCheck, Eye, EyeOff, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { asApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { useResetPassword } from "../services/auth.service";
import { PASSWORD_MIN_LENGTH } from "../validation/register.schema";
import { resetPasswordSchema, type ResetPasswordValues } from "../validation/password.schema";

const primary = cn(buttonVariants({ size: "lg" }), "h-11 w-full text-[15px] font-semibold");

/** The emailed link's landing page (/reset-password?token=…): choose a new password. */
export default function ResetPasswordScreen() {
  const token = useSearchParams().get("token");
  const reset = useResetPassword();
  const [linkDead, setLinkDead] = useState(false);
  const [shown, setShown] = useState(false);
  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirm: "" },
    mode: "onTouched",
  });
  const {
    register,
    formState: { errors, isSubmitting },
  } = form;

  const onSubmit = form.handleSubmit(async ({ password }) => {
    if (!token) return;
    try {
      await reset.mutateAsync({ token, password });
    } catch (error) {
      const code = asApiError(error).code;
      if (code === "INVALID_TOKEN") setLinkDead(true);
      else
        form.setError("root", {
          message:
            code === "TOO_MANY_REQUESTS"
              ? "Too many attempts. Wait a minute, then try again."
              : code === "NETWORK_ERROR"
                ? "Can't reach Muster. Check your connection, then try again."
                : "Couldn't change your password. Try again in a moment.",
        });
    }
  });

  if (reset.isSuccess) {
    return (
      <Screen
        icon={<CircleCheck className="size-6" aria-hidden />}
        title="Password changed"
        body="For your safety you've been signed out on every device. Sign in with your new password."
      >
        <Link href="/login" className={primary}>
          Sign in
        </Link>
      </Screen>
    );
  }

  if (!token || linkDead) {
    return (
      <Screen
        tone="error"
        icon={<CircleAlert className="size-6" aria-hidden />}
        title={token ? "This link doesn't work" : "This link is incomplete"}
        body={
          token
            ? "Reset links work once, for 30 minutes. Ask for a new one."
            : "Open the link from your email again, or ask for a new one."
        }
      >
        <Link href="/forgot-password" className={primary}>
          Send a new link
        </Link>
      </Screen>
    );
  }

  const toggle = (
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
  );

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-5xl leading-none font-extrabold font-stretch-70%">Choose a new password</h1>
        <p className="text-muted-foreground">You&rsquo;ll be signed out everywhere, then sign in with it.</p>
      </header>

      <form method="post" onSubmit={onSubmit} noValidate className="space-y-6">
        <Field data-invalid={!!errors.password}>
          <FieldLabel htmlFor="password">New password</FieldLabel>
          <InputGroup className="h-11">
            <InputGroupInput
              id="password"
              type={shown ? "text" : "password"}
              autoComplete="new-password"
              autoFocus
              aria-invalid={!!errors.password}
              {...register("password")}
            />
            {toggle}
          </InputGroup>
          {errors.password ? (
            <FieldError errors={[errors.password]} />
          ) : (
            <FieldDescription>At least {PASSWORD_MIN_LENGTH} characters. A short phrase works well.</FieldDescription>
          )}
        </Field>
        <Field data-invalid={!!errors.confirm}>
          <FieldLabel htmlFor="confirm">Type it again</FieldLabel>
          <InputGroup className="h-11">
            <InputGroupInput
              id="confirm"
              type={shown ? "text" : "password"}
              autoComplete="new-password"
              aria-invalid={!!errors.confirm}
              {...register("confirm")}
            />
          </InputGroup>
          <FieldError errors={[errors.confirm]} />
        </Field>

        {errors.root && (
          <p role="alert" className="text-sm text-destructive">
            {errors.root.message}
          </p>
        )}

        <Button type="submit" size="lg" className="h-11 w-full text-[15px] font-semibold" disabled={isSubmitting}>
          {isSubmitting && <LoaderCircle className="animate-spin" aria-hidden />}
          {isSubmitting ? "Saving…" : "Change password"}
        </Button>
      </form>
    </div>
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
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-8" role="status">
      <header className="space-y-3">
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
      {children}
    </div>
  );
}
