"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
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
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { asApiError } from "@/lib/api/client";
import { useCreateOrganisation } from "../services/organisation.service";
import { createWorkspaceSchema, type CreateWorkspaceValues } from "../validation/workspace.schema";

/** Name a new workspace; you become its owner and land in it. */
export default function CreateWorkspaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const createOrganisation = useCreateOrganisation();
  const form = useForm<CreateWorkspaceValues>({
    resolver: zodResolver(createWorkspaceSchema),
    defaultValues: { name: "" },
  });
  const {
    register,
    formState: { errors, isSubmitting },
  } = form;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const organisation = await createOrganisation.mutateAsync(values);
      onOpenChange(false);
      form.reset();
      router.push(`/o/${organisation.slug}`);
    } catch (error) {
      const apiError = asApiError(error);
      form.setError("root", {
        message:
          apiError.code === "NETWORK_ERROR"
            ? "Can't reach Muster. Check your connection, then try again."
            : apiError.code === "TOO_MANY_REQUESTS"
              ? "Too many attempts. Wait a minute, then try again."
              : "Couldn't create the workspace. Try again in a moment.",
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
        <form onSubmit={onSubmit} noValidate className="space-y-6">
          <DialogHeader>
            <DialogTitle className="text-3xl leading-none font-extrabold font-stretch-70%">
              Create a workspace
            </DialogTitle>
            <DialogDescription>
              One space for your university, company or community. You&rsquo;ll be its owner, and it
              starts with a club called General.
            </DialogDescription>
          </DialogHeader>

          <Field data-invalid={!!errors.name}>
            <FieldLabel htmlFor="workspace-name">Name</FieldLabel>
            <InputGroup className="h-11">
              <InputGroupInput
                id="workspace-name"
                autoComplete="organization"
                placeholder="State University"
                autoFocus
                aria-invalid={!!errors.name}
                aria-describedby={errors.name ? "workspace-name-error" : "workspace-name-hint"}
                {...register("name")}
              />
            </InputGroup>
            {errors.name ? (
              <FieldError id="workspace-name-error" errors={[errors.name]} />
            ) : (
              <FieldDescription id="workspace-name-hint">
                You can change it later. Its web address is made from the name.
              </FieldDescription>
            )}
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
              {isSubmitting ? "Creating…" : "Create workspace"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
