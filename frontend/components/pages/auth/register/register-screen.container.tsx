"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { type ApiError, asApiError } from "@/lib/api/client";
import { useResendVerification, useSignUp } from "../services/auth.service";
import { nextPath } from "../shared/session-guards";
import { registerSchema, type RegisterValues } from "../validation/register.schema";
import RegisterScreenView, { type RegisterNotice } from "./register-screen.view";

/** Turns an API error code into what the screen shows. */
function noticeFor(error: ApiError): RegisterNotice {
  switch (error.code) {
    case "EMAIL_TAKEN":
      return {
        kind: "taken",
        title: "This email already has an account",
        body: "Sign in instead, or reset your password if you've forgotten it.",
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
        body: "One of the fields isn't valid.",
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
        title: "Couldn't create your account",
        body: "Something went wrong on our side. Try again in a moment.",
      };
  }
}

/** State and side effects for the sign-up screen; the view only renders. */
export default function RegisterScreenContainer() {
  const [notice, setNotice] = useState<RegisterNotice | null>(null);
  // where they came from (an invite link): the confirmation email links back to it.
  // Read once: this only renders in the browser (behind GuestOnly).
  const [next] = useState(nextPath);
  const signUp = useSignUp();
  const resendVerification = useResendVerification();
  // the address the confirmation link went to; set once the account exists
  const sentTo = signUp.data?.email ?? null;

  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: "", email: "", password: "" },
    mode: "onTouched",
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setNotice(null);
    try {
      // awaited, so the form stays "submitting" until the API answers
      await signUp.mutateAsync({ ...values, ...(next && { next }) });
    } catch (error) {
      const apiError = asApiError(error);
      setNotice(noticeFor(apiError));
      if (apiError.code === "EMAIL_TAKEN") form.setFocus("email");
    }
  });

  const onResendVerification = () => {
    if (sentTo) resendVerification.mutate({ email: sentTo, ...(next && { next }) });
  };

  const resend = resendVerification.isPending
    ? "sending"
    : resendVerification.isSuccess
      ? "sent"
      : "idle";

  // wrong address: back to the form, everything but the password kept
  const onChangeEmail = () => {
    signUp.reset();
    resendVerification.reset();
    form.resetField("password");
    // the form mounts again on the next render; focus it once it is there
    setTimeout(() => form.setFocus("email"));
  };

  return (
    <RegisterScreenView
      form={form}
      onSubmit={onSubmit}
      notice={notice}
      sentTo={sentTo}
      resend={resend}
      onResendVerification={onResendVerification}
      onChangeEmail={onChangeEmail}
      next={next}
    />
  );
}
