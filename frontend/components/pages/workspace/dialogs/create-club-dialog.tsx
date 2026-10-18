"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle } from "lucide-react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { Textarea } from "@/components/ui/textarea";
import { asApiError } from "@/lib/api/client";
import type { ClubSummary } from "@/types/club.interface";
import { useCreateClub } from "../services/club.service";
import { createClubSchema, type CreateClubValues } from "../validation/event.schema";

/** Add a club to the workspace; you hold its Owner role. Admins and owners only. */
export default function CreateClubDialog({
  open,
  onOpenChange,
  orgId,
  workspaceName,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  workspaceName: string;
  onCreated: (club: ClubSummary) => void;
}) {
  const createClub = useCreateClub(orgId);
  const form = useForm<CreateClubValues>({
    resolver: zodResolver(createClubSchema),
    defaultValues: { name: "", description: "" },
  });
  const {
    register,
    formState: { errors, isSubmitting },
  } = form;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const club = await createClub.mutateAsync({ name: values.name, description: values.description || undefined });
      form.reset();
      onOpenChange(false);
      onCreated(club);
    } catch (error) {
      const code = asApiError(error).code;
      form.setError("root", {
        message:
          code === "INSUFFICIENT_ORG_ROLE"
            ? "Only workspace admins can add clubs."
            : code === "NETWORK_ERROR"
              ? "Can't reach Muster. Check your connection, then try again."
              : "Couldn't create the club. Try again in a moment.",
      });
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) form.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          <DialogHeader>
            <DialogTitle className="text-3xl leading-none font-extrabold font-stretch-70%">New club</DialogTitle>
            <DialogDescription>
              In {workspaceName}. You&rsquo;ll be its owner, and can give others roles like Organizer.
            </DialogDescription>
          </DialogHeader>

          <Field data-invalid={!!errors.name}>
            <FieldLabel htmlFor="club-name">Name</FieldLabel>
            <InputGroup className="h-11">
              <InputGroupInput id="club-name" placeholder="Coding Club" autoFocus aria-invalid={!!errors.name} {...register("name")} />
            </InputGroup>
            <FieldError errors={[errors.name]} />
          </Field>

          <Field data-invalid={!!errors.description}>
            <FieldLabel htmlFor="club-description">What it&rsquo;s for</FieldLabel>
            <Textarea id="club-description" rows={2} placeholder="Weekly build nights and workshops" {...register("description")} />
            <FieldError errors={[errors.description]} />
          </Field>

          {errors.root && (
            <p role="alert" className="text-sm text-destructive">
              {errors.root.message}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <LoaderCircle className="animate-spin" aria-hidden />}
              {isSubmitting ? "Creating…" : "Create club"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
