"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { asApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import type { AuthUser } from "@/types";
import { useUpdateProfile } from "../../auth/services/auth.service";
import {
  profileSchema,
  type ProfileValues,
} from "../../auth/validation/password.schema";
import { AccountRow, actionSize } from "./account-row";

/** Your name. `onDraft` reports it as you type, so the pass can follow along. */
export function ProfileSection({
  me,
  onDraft,
}: {
  me: AuthUser;
  onDraft: (name: string) => void;
}) {
  const update = useUpdateProfile();
  const [saved, setSaved] = useState(false);
  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: me.name },
  });
  const {
    register,
    formState: { errors, isSubmitting, isDirty },
  } = form;

  const onSubmit = form.handleSubmit(async ({ name }) => {
    setSaved(false);
    try {
      const updated = await update.mutateAsync({ name });
      form.reset({ name: updated.name });
      onDraft(updated.name);
      setSaved(true);
    } catch (error) {
      form.setError("root", {
        message:
          asApiError(error).code === "NETWORK_ERROR"
            ? "Can't reach Muster. Check your connection, then try again."
            : "Couldn't save your name. Try again in a moment.",
      });
    }
  });

  return (
    <AccountRow
      id="profile-heading"
      title="Profile"
      description="Your name goes on your pass, attendee lists and every ticket."
    >
      <form method="post" onSubmit={onSubmit} noValidate>
        <Field data-invalid={!!errors.name}>
          <FieldLabel htmlFor="name">Name</FieldLabel>
          <div className="flex gap-2">
            <InputGroup className="h-11 min-w-0 flex-1">
              <InputGroupInput
                id="name"
                autoComplete="name"
                aria-invalid={!!errors.name}
                {...register("name", {
                  onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
                    setSaved(false);
                    onDraft(event.target.value);
                  },
                })}
              />
            </InputGroup>
            <Button
              type="submit"
              variant={isDirty ? "default" : "outline"}
              className={cn(actionSize, !isDirty && "disabled:opacity-60")}
              disabled={isSubmitting || !isDirty}
            >
              {isSubmitting && (
                <LoaderCircle className="animate-spin" aria-hidden />
              )}
              {isSubmitting ? "Saving…" : "Save"}
            </Button>
          </div>
          <div role="status">
            {errors.name ? (
              <FieldError errors={[errors.name]} />
            ) : errors.root ? (
              <p className="text-sm text-destructive">{errors.root.message}</p>
            ) : saved ? (
              <FieldDescription className="flex items-center gap-1.5">
                <Check className="size-4 text-cobalt" aria-hidden />
                Saved. Clubs see the new name from now on.
              </FieldDescription>
            ) : (
              <FieldDescription>
                Your email can&rsquo;t be changed yet.
              </FieldDescription>
            )}
          </div>
        </Field>
      </form>
    </AccountRow>
  );
}
