"use client";

import { Check, LoaderCircle, Trash2 } from "lucide-react";
import type { UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";
import type { JoinPolicy } from "@/types/organisation.interface";
import { ConfirmDialog } from "../shared/confirm-dialog";
import type { WorkspaceSettingsValues } from "../validation/workspace.schema";

const POLICIES: { value: JoinPolicy; label: string; hint: string }[] = [
  { value: "invite", label: "Invite links only", hint: "People join with a link a member shares. Nobody else can find it." },
  { value: "request", label: "Ask to join", hint: "Anyone with the address can ask; a moderator approves or declines." },
  { value: "open", label: "Anyone with the link", hint: "People join straight away, no review." },
];

interface SettingsViewProps {
  allowed: boolean;
  isOwner: boolean;
  workspaceName: string;
  slug: string;
  form: UseFormReturn<WorkspaceSettingsValues>;
  onSaveDetails: (event?: React.BaseSyntheticEvent) => Promise<void>;
  saved: "details" | "policy" | null;
  policy: JoinPolicy | null;
  currentPolicy: JoinPolicy | null;
  onPolicyChange: (policy: JoinPolicy) => void;
  onSavePolicy: () => void;
  savingPolicy: boolean;
  policyError: string | null;
  deleting: boolean;
  onDeletingChange: (open: boolean) => void;
  confirmSlug: string;
  onConfirmSlugChange: (value: string) => void;
  onDelete: () => Promise<string | null>;
}

/** Workspace settings for admins; deleting is the owner's alone. Presentational. */
const SettingsView = (props: SettingsViewProps) => {
  const { allowed, isOwner, workspaceName, slug, form, onSaveDetails, saved } = props;
  const {
    register,
    formState: { errors, isSubmitting, isDirty },
  } = form;

  if (!allowed) {
    return (
      <section className="max-w-xl px-5 py-6 sm:px-8 lg:py-8">
        <h1 className="text-4xl leading-none font-extrabold font-stretch-70%">Settings</h1>
        <p className="mt-3 text-muted-foreground">Admins and the owner change the workspace&rsquo;s settings.</p>
      </section>
    );
  }

  return (
    <section className="w-full max-w-2xl px-5 py-6 sm:px-8 lg:py-8">
      <h1 className="text-5xl leading-none font-extrabold font-stretch-70%">Settings</h1>

      {/* name and address */}
      <form onSubmit={onSaveDetails} noValidate className="mt-8 space-y-5 border-b pb-10">
        <h2 className="text-xl font-bold font-stretch-80%">Name and address</h2>
        <Field data-invalid={!!errors.name}>
          <FieldLabel htmlFor="workspace-name">Name</FieldLabel>
          <InputGroup className="h-11">
            <InputGroupInput id="workspace-name" aria-invalid={!!errors.name} {...register("name")} />
          </InputGroup>
          <FieldError errors={[errors.name]} />
        </Field>
        <Field data-invalid={!!errors.slug}>
          <FieldLabel htmlFor="workspace-slug">Web address</FieldLabel>
          <InputGroup className="h-11">
            <InputGroupAddon>
              <InputGroupText>/o/</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              id="workspace-slug"
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={!!errors.slug}
              {...register("slug")}
            />
          </InputGroup>
          {errors.slug ? (
            <FieldError errors={[errors.slug]} />
          ) : (
            <FieldDescription>Changing it breaks links people already have to this workspace.</FieldDescription>
          )}
        </Field>
        {errors.root && (
          <p role="alert" className="text-sm text-destructive">
            {errors.root.message}
          </p>
        )}
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={isSubmitting || !isDirty}>
            {isSubmitting && <LoaderCircle className="animate-spin" aria-hidden />}
            {isSubmitting ? "Saving…" : "Save changes"}
          </Button>
          <SavedNote show={saved === "details"} />
        </div>
      </form>

      <JoinPolicySection {...props} />

      {/* deleting: only the owner, and only after typing the address */}
      <div className="py-10">
        <h2 className="text-xl font-bold font-stretch-80%">Delete workspace</h2>
        <p className="mt-1 max-w-prose text-muted-foreground">
          Removes {workspaceName} with every club, event and registration in it, for good.
        </p>
        {isOwner ? (
          <Button variant="destructive" className="mt-4" onClick={() => props.onDeletingChange(true)}>
            <Trash2 aria-hidden />
            Delete workspace
          </Button>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Only the owner can delete it.</p>
        )}
      </div>

      <ConfirmDialog
        open={props.deleting}
        onOpenChange={props.onDeletingChange}
        title={`Delete ${workspaceName}?`}
        body="Every club, event and registration in it goes too. This can't be undone."
        confirmLabel="Delete workspace"
        pendingLabel="Deleting…"
        destructive
        confirmDisabled={props.confirmSlug.trim().toLowerCase() !== slug}
        onConfirm={props.onDelete}
      >
        <Field>
          <FieldLabel htmlFor="confirm-slug">
            Type <span className="font-semibold">{slug}</span> to confirm
          </FieldLabel>
          <InputGroup className="h-11">
            <InputGroupInput
              id="confirm-slug"
              autoCapitalize="none"
              spellCheck={false}
              autoComplete="off"
              value={props.confirmSlug}
              onChange={(event) => props.onConfirmSlugChange(event.target.value)}
            />
          </InputGroup>
        </Field>
      </ConfirmDialog>
    </section>
  );
};

function JoinPolicySection({
  policy,
  currentPolicy,
  onPolicyChange,
  onSavePolicy,
  savingPolicy,
  policyError,
  saved,
}: SettingsViewProps) {
  return (
    <fieldset className="space-y-3 border-b py-10">
      <legend className="sr-only">Who can join</legend>
      <h2 className="text-xl font-bold font-stretch-80%" aria-hidden>
        Who can join
      </h2>
      {policy === null ? (
        <div className="h-40 animate-pulse rounded-xl bg-muted/60 motion-reduce:animate-none" aria-hidden />
      ) : (
        <div className="grid gap-2">
          {POLICIES.map(({ value, label, hint }) => (
            <label
              key={value}
              className={cn(
                "flex cursor-pointer gap-3 rounded-xl border p-4 transition-colors has-checked:border-cobalt has-checked:bg-cobalt-50",
                "has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
              )}
            >
              <input
                type="radio"
                name="join-policy"
                value={value}
                checked={policy === value}
                onChange={() => onPolicyChange(value)}
                className="mt-1 accent-cobalt"
              />
              <span>
                <span className="block font-medium">
                  {label}
                  {currentPolicy === value && <span className="font-normal text-muted-foreground"> (current)</span>}
                </span>
                <span className="text-sm text-muted-foreground">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      )}
      {policyError && (
        <p role="alert" className="text-sm text-destructive">
          {policyError}
        </p>
      )}
      <div className="flex items-center gap-3 pt-1">
        <Button type="button" onClick={onSavePolicy} disabled={savingPolicy || !policy || policy === currentPolicy}>
          {savingPolicy && <LoaderCircle className="animate-spin" aria-hidden />}
          {savingPolicy ? "Saving…" : "Save"}
        </Button>
        <SavedNote show={saved === "policy"} />
      </div>
    </fieldset>
  );
}

function SavedNote({ show }: { show: boolean }) {
  return (
    <p role="status" className="flex items-center gap-1.5 text-sm text-muted-foreground">
      {show && (
        <>
          <Check className="size-4 text-cobalt" aria-hidden />
          Saved
        </>
      )}
    </p>
  );
}

export default SettingsView;
