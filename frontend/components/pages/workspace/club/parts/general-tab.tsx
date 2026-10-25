"use client";

import { Check, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ClubJoinPolicy, ClubSettings, UpdateClubSettingsInput } from "@/types";

export const CLUB_POLICIES: { value: ClubJoinPolicy; label: string; hint: string }[] = [
  {
    value: "open",
    label: "Anyone in the workspace",
    hint: "People find the club in Browse clubs and join straight away.",
  },
  {
    value: "request",
    label: "Ask to join",
    hint: "People find the club in Browse clubs and ask. Anyone here who can approve members decides, under Join requests.",
  },
  {
    value: "invite",
    label: "Invite links only",
    hint: "The club stays out of Browse clubs. People join with a link from Invite links.",
  },
];

export interface GeneralTabProps {
  settings: ClubSettings;
  workspaceName: string;
  // the owner, or role.manage
  canEdit: boolean;
  // resolves to an error message, or null when saved
  onSave: (changes: UpdateClubSettingsInput) => Promise<string | null>;
}

/** The club's name, description and who can join. Keyed by club, so it starts from the saved settings. */
export function GeneralTab({ settings, workspaceName, canEdit, onSave }: GeneralTabProps) {
  const [name, setName] = useState(settings.name);
  const [description, setDescription] = useState(settings.description ?? "");
  const [policy, setPolicy] = useState(settings.joinPolicy);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // only what changed is sent
  const changes: UpdateClubSettingsInput = {
    ...(name.trim() !== settings.name && { name: name.trim() }),
    ...(description.trim() !== (settings.description ?? "") && { description: description.trim() }),
    ...(!settings.isDefault && policy !== settings.joinPolicy && { joinPolicy: policy }),
  };
  const dirty = Object.keys(changes).length > 0;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return setError("The club needs a name.");
    setSaving(true);
    setSaved(false);
    setError(null);
    const failure = await onSave(changes);
    setSaving(false);
    if (failure) setError(failure);
    else setSaved(true);
  };

  return (
    <form onSubmit={save} noValidate className="max-w-2xl space-y-8">
      <div className="space-y-5">
        <Field>
          <FieldLabel htmlFor="club-name">Name</FieldLabel>
          <InputGroup className="h-11">
            <InputGroupInput
              id="club-name"
              value={name}
              maxLength={100}
              disabled={!canEdit}
              onChange={(event) => setName(event.target.value)}
            />
          </InputGroup>
        </Field>
        <Field>
          <FieldLabel htmlFor="club-description">Description</FieldLabel>
          <Textarea
            id="club-description"
            value={description}
            maxLength={500}
            rows={3}
            disabled={!canEdit}
            placeholder="What the club does, and when it meets"
            onChange={(event) => setDescription(event.target.value)}
          />
          <FieldDescription>Shows at the top of the club&rsquo;s events, and in Browse clubs.</FieldDescription>
        </Field>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-xl font-bold font-stretch-80%">Who can join</legend>
        {settings.isDefault ? (
          <p className="max-w-prose text-muted-foreground">
            Everyone in {workspaceName} is in this club. Who can join the workspace is set in the workspace&rsquo;s settings.
          </p>
        ) : (
          <div className="grid gap-2">
            {CLUB_POLICIES.map(({ value, label, hint }) => (
              <label
                key={value}
                className={cn(
                  "flex gap-3 rounded-xl border p-4 transition-colors has-checked:border-cobalt has-checked:bg-cobalt-50",
                  "has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                  canEdit ? "cursor-pointer" : "cursor-default opacity-80",
                )}
              >
                <input
                  type="radio"
                  name="club-join-policy"
                  value={value}
                  checked={policy === value}
                  disabled={!canEdit}
                  onChange={() => setPolicy(value)}
                  className="mt-1 accent-cobalt"
                />
                <span>
                  <span className="block font-medium">
                    {label}
                    {settings.joinPolicy === value && <span className="font-normal text-muted-foreground"> (current)</span>}
                  </span>
                  <span className="text-sm text-muted-foreground">{hint}</span>
                </span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      {canEdit ? (
        <div className="space-y-2">
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={saving || !dirty}>
              {saving && <LoaderCircle className="animate-spin" aria-hidden />}
              {saving ? "Saving…" : "Save changes"}
            </Button>
            <p role="status" className="flex items-center gap-1.5 text-sm text-muted-foreground">
              {saved && !dirty && (
                <>
                  <Check className="size-4 text-cobalt" aria-hidden />
                  Saved
                </>
              )}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">The club&rsquo;s owner, or anyone who can manage its roles, changes these.</p>
      )}
    </form>
  );
}
