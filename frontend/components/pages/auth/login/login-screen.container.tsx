"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { type ApiError, asApiError } from "@/lib/api/client";
import { useResendVerification, useSignIn } from "../services/auth.service";
import { afterSignIn, nextPath } from "../shared/session-guards";
import { loginSchema, type LoginValues } from "../validation/login.schema";
import LoginScreenView, { type LoginNotice } from "./login-screen.view";


/** Turns an API error code into what the screen shows. */
function noticeFor(error: ApiError): LoginNotice {
  switch (error.code) {
    case "INVALID_CREDENTIALS":
      return {
        kind: "error",
        title: "Incorrect email or password",
        body: "Check both and try again.",
      };
    case "EMAIL_NOT_VERIFIED":
      return {
        kind: "unverified",
        title: "Confirm your email first",
        body: "We sent you a link when you signed up. Open it to activate your account.",
      };
    case "TOO_MANY_REQUESTS":
      return {
        kind: "error",
        title: "Too many attempts",
        body: "Wait a minute, then try again.",
      };
    case "VALIDATION_ERROR":
      return {
        kind: "error",
        title: "Check your details",
        body: "That email or password isn't valid.",
      };
    case "NETWORK_ERROR":
      return {
        kind: "error",
        title: "Can't reach Muster",
        body: "Check your internet connection, then try again.",
      };
    default:
      // a server fault or a bug: the details are for the console, not the person
      return {
        kind: "error",
        title: "Couldn't sign you in",
        body: "Something went wrong on our side. Try again in a moment.",
      };
  }
}

/** State and side effects for the sign-in screen; the view only renders. */
export default function LoginScreenContainer() {
  const router = useRouter();
  const [notice, setNotice] = useState<LoginNotice | null>(null);
  const signIn = useSignIn();
  const resendVerification = useResendVerification();
  // where they came from (an invite link), kept through sign up and resends.
  // Read once: this only renders in the browser (behind GuestOnly).
  const [next] = useState(nextPath);

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
    mode: "onTouched",
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setNotice(null);
    resendVerification.reset();
    try {
      // awaited, so the form stays "submitting" until the API answers;
      // the service keeps the access token
      await signIn.mutateAsync(values);
      router.replace(afterSignIn());
    } catch (error) {
      setNotice(noticeFor(asApiError(error)));
      // keep the email, clear the password: the usual retry is retyping it
      form.resetField("password");
      form.setFocus("password");
    }
  });

  const onResendVerification = () =>
    resendVerification.mutate(
      { email: form.getValues("email"), ...(next && { next }) },
      {
        onError: () =>
          setNotice({
            kind: "error",
            title: "Couldn't send the email",
            body: "Try again in a minute.",
          }),
      },
    );

  const resend = resendVerification.isPending
    ? "sending"
    : resendVerification.isSuccess
      ? "sent"
      : "idle";

  return (
    <LoginScreenView
      form={form}
      onSubmit={onSubmit}
      notice={notice}
      resend={resend}
      onResendVerification={onResendVerification}
      next={next}
    />
  );
}
