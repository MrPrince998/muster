"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle, MailCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
import { useJoinOrganisation } from "../services/organisation.service";
import {
  joinWorkspaceSchema,
  type JoinWorkspaceValues,
  slugFromAddress,
} from "../validation/workspace.schema";

/** What each refusal means for the person, and what to do next. */
function messageFor(code: string): string {
  switch (code) {
    case "ORG_NOT_FOUND":
      return "No workspace at that address takes requests. If it's invite-only, ask a member for an invite link.";
    case "REQUEST_PENDING":
      return "You've already asked to join. A moderator will review your request.";
    case "REQUEST_RECENTLY_REJECTED":
      return "Your last request was declined recently. Try again later, or ask a member for an invite link.";
    case "TOO_MANY_REQUESTS":
      return "Too many attempts. Wait a minute, then try again.";
    case "NETWORK_ERROR":
      return "Can't reach Muster. Check your connection, then try again.";
    default:
      return "Couldn't join the workspace. Try again in a moment.";
  }
}

/** Join an open workspace, or ask to join one that reviews requests. */
export default function JoinWorkspaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const joinOrganisation = useJoinOrganisation();
  // set when the workspace reviews requests: the dialog then confirms it was sent
  const [requestedSlug, setRequestedSlug] = useState<string | null>(null);
  const form = useForm<JoinWorkspaceValues>({
    resolver: zodResolver(joinWorkspaceSchema),
    defaultValues: { address: "" },
  });
  const {
    register,
    formState: { errors, isSubmitting },
  } = form;

  const close = () => {
    onOpenChange(false);
    form.reset();
    setRequestedSlug(null);
  };

  const onSubmit = form.handleSubmit(async ({ address }) => {
    const slug = slugFromAddress(address);
    try {
      const result = await joinOrganisation.mutateAsync({ slug });
      if (result.status === "requested") {
        setRequestedSlug(slug);
        return;
      }
      close();
      router.push(`/o/${result.organisation?.slug ?? slug}`);
    } catch (error) {
      const apiError = asApiError(error);
      // already in: just take them there
      if (apiError.code === "ALREADY_MEMBER") {
        close();
        router.push(`/o/${slug}`);
        return;
      }
      form.setError("root", { message: messageFor(apiError.code) });
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-md">
        {requestedSlug ? (
          <div className="space-y-6" role="status">
            <DialogHeader>
              <span className="grid size-12 place-items-center rounded-full bg-cobalt-50 text-cobalt">
                <MailCheck className="size-6" aria-hidden />
              </span>
              <DialogTitle className="text-3xl leading-none font-extrabold font-stretch-70%">
                Request sent
              </DialogTitle>
              <DialogDescription>
                A moderator of <span className="font-semibold text-foreground">{requestedSlug}</span>{" "}
                will review it. It shows up here once you&rsquo;re in.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" onClick={close}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate className="space-y-6">
            <DialogHeader>
              <DialogTitle className="text-3xl leading-none font-extrabold font-stretch-70%">
                Join a workspace
              </DialogTitle>
              <DialogDescription>
                Paste the workspace&rsquo;s link. Open workspaces let you in straight away; others
                send your request to a moderator.
              </DialogDescription>
            </DialogHeader>

            <Field data-invalid={!!errors.address}>
              <FieldLabel htmlFor="workspace-address">Workspace link</FieldLabel>
              <InputGroup className="h-11">
                <InputGroupInput
                  id="workspace-address"
                  autoCapitalize="none"
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="muster.app/o/state-uni"
                  autoFocus
                  aria-invalid={!!errors.address}
                  aria-describedby={errors.address ? "workspace-address-error" : "workspace-address-hint"}
                  {...register("address")}
                />
              </InputGroup>
              {errors.address ? (
                <FieldError id="workspace-address-error" errors={[errors.address]} />
              ) : (
                <FieldDescription id="workspace-address-hint">
                  The full link, or just the part after /o/, like state-uni.
                </FieldDescription>
              )}
            </Field>

            {errors.root && (
              <p role="alert" className="text-sm text-destructive">
                {errors.root.message}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <LoaderCircle className="animate-spin" aria-hidden />}
                {isSubmitting ? "Joining…" : "Join workspace"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
