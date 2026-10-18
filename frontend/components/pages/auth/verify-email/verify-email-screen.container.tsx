"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { asApiError } from "@/lib/api/client";
import { useResendVerification, useVerifyEmail } from "../services/auth.service";
import {
  resendVerificationSchema,
  type ResendVerificationValues,
} from "../validation/resend-verification.schema";
import VerifyEmailScreenView, { type VerifyStatus } from "./verify-email-screen.view";
import { safeNext } from "../shared/session-guards";

/** Confirms the token from the emailed link as soon as the page opens. */
export default function VerifyEmailScreenContainer() {
  const params = useSearchParams();
  const token = params.get("token");
  // set when they signed up from an invite link: where to go once confirmed
  const next = safeNext(params.get("next"));
  const verifyEmail = useVerifyEmail();
  const resendVerification = useResendVerification();

  // Each link works once, and in development React runs effects twice: a
  // second POST would fail as "used" right after the first succeeded. The
  // ref keeps the token that was already sent.
  const sentToken = useRef<string | null>(null);
  const { mutate } = verifyEmail;
  useEffect(() => {
    if (!token || sentToken.current === token) return;
    sentToken.current = token;
    mutate({ token });
  }, [token, mutate]);

  const form = useForm<ResendVerificationValues>({
    resolver: zodResolver(resendVerificationSchema),
    defaultValues: { email: "" },
    mode: "onTouched",
  });

  const onResend = form.handleSubmit(async (values) => {
    try {
      // awaited, so the form stays "submitting" until the API answers
      await resendVerification.mutateAsync({ ...values, ...(next && { next }) });
    } catch (error) {
      asApiError(error); // logs anything unexpected; the view shows the error
    }
  });

  const onRetry = () => {
    if (token) mutate({ token });
  };

  return (
    <VerifyEmailScreenView
      next={next}
      status={statusFor(token, verifyEmail)}
      form={form}
      onResend={onResend}
      resent={resendVerification.isSuccess}
      resendError={resendVerification.error?.code ?? null}
      onRetry={onRetry}
    />
  );
}

/** What the screen shows for the token and the request's progress. */
function statusFor(
  token: string | null,
  { isSuccess, error }: ReturnType<typeof useVerifyEmail>,
): VerifyStatus {
  if (!token) return "missing";
  if (isSuccess) return "verified";
  if (!error) return "verifying";
  switch (error.code) {
    case "INVALID_TOKEN":
    case "VALIDATION_ERROR":
      return "invalid";
    case "TOO_MANY_REQUESTS":
      return "rate-limited";
    case "NETWORK_ERROR":
      return "offline";
    default:
      return "failed";
  }
}
