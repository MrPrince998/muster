"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { JoinPolicy } from "@/types/organisation.interface";
import { useWorkspace } from "../org-shell/workspace-context";
import { useDeleteOrganisation, useUpdateOrganisation } from "../services/organisation.service";
import { workspaceErrorMessage } from "../shared/workspace-errors";
import { workspaceSettingsSchema, type WorkspaceSettingsValues } from "../validation/workspace.schema";
import SettingsView from "./settings.view";

/** /o/[slug]/settings: name and address, who can join, and deleting (owner). */
export default function SettingsContainer() {
  const router = useRouter();
  const { organisation, detail, can } = useWorkspace();
  const orgId = organisation.orgId;
  const update = useUpdateOrganisation(orgId);
  const remove = useDeleteOrganisation(orgId);

  const form = useForm<WorkspaceSettingsValues>({
    resolver: zodResolver(workspaceSettingsSchema),
    defaultValues: { name: organisation.name, slug: organisation.slug },
  });
  const [saved, setSaved] = useState<"details" | "policy" | null>(null);

  // the policy saves on its own: your unsaved choice, else the workspace's current one
  const [policyChoice, setPolicyChoice] = useState<JoinPolicy | null>(null);
  const policy = policyChoice ?? detail?.joinPolicy ?? null;
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [savingPolicy, setSavingPolicy] = useState(false);

  const [deleting, setDeleting] = useState(false);
  const [confirmSlug, setConfirmSlug] = useState("");

  const onSaveDetails = form.handleSubmit(async (values) => {
    setSaved(null);
    try {
      const updated = await update.mutateAsync({ name: values.name, slug: values.slug });
      form.reset({ name: updated.name, slug: updated.slug });
      setSaved("details");
      // a new address is a new URL: follow it
      if (updated.slug !== organisation.slug) router.replace(`/o/${updated.slug}/settings`);
    } catch (error) {
      form.setError("root", { message: workspaceErrorMessage(error) });
    }
  });

  const onSavePolicy = async () => {
    if (!policy) return;
    setSavingPolicy(true);
    setPolicyError(null);
    setSaved(null);
    try {
      await update.mutateAsync({ joinPolicy: policy });
      setPolicyChoice(null); // the refreshed workspace now holds it
      setSaved("policy");
    } catch (error) {
      setPolicyError(workspaceErrorMessage(error));
    } finally {
      setSavingPolicy(false);
    }
  };

  const onDelete = async (): Promise<string | null> => {
    try {
      await remove.mutateAsync({ confirmSlug });
      router.replace("/workspaces");
      return null;
    } catch (error) {
      return workspaceErrorMessage(error);
    }
  };

  return (
    <SettingsView
      allowed={can.changeSettings}
      isOwner={organisation.role === "owner"}
      workspaceName={organisation.name}
      slug={organisation.slug}
      form={form}
      timeZone={{ orgId, current: organisation.timeZone }}
      onSaveDetails={onSaveDetails}
      saved={saved}
      policy={policy}
      currentPolicy={detail?.joinPolicy ?? null}
      onPolicyChange={(next) => {
        setPolicyChoice(next);
        setSaved(null);
      }}
      onSavePolicy={onSavePolicy}
      savingPolicy={savingPolicy}
      policyError={policyError}
      deleting={deleting}
      onDeletingChange={(open) => {
        setDeleting(open);
        if (!open) setConfirmSlug("");
      }}
      confirmSlug={confirmSlug}
      onConfirmSlugChange={setConfirmSlug}
      onDelete={onDelete}
    />
  );
}
