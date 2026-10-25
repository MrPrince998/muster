"use client";

import { useState } from "react";
import type { ClubDirectoryEntry } from "@/types";
import { useWorkspace } from "../org-shell/workspace-context";
import { useCancelClubRequest, useClubDirectory, useJoinClub } from "../services/club-directory.service";
import { workspaceErrorMessage } from "../shared/workspace-errors";
import ClubDirectoryView from "./club-directory.view";

// a copy of `record` without `key`
const without = <T,>(record: Record<string, T>, key: string) =>
  Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));

/** /o/[slug]/clubs: join a club that's open, or ask one that takes requests. */
export default function ClubDirectoryContainer() {
  const { organisation } = useWorkspace();
  const orgId = organisation.orgId;
  const directory = useClubDirectory(orgId);
  const join = useJoinClub(orgId);
  const cancel = useCancelClubRequest(orgId);
  const [working, setWorking] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [announcement, setAnnouncement] = useState("");
  const [asking, setAsking] = useState<ClubDirectoryEntry | null>(null);
  const [message, setMessage] = useState("");

  // runs one club's action, keeping its error next to it
  const act = async (club: ClubDirectoryEntry, work: () => Promise<unknown>, done: string) => {
    setWorking(club.id);
    setErrors((current) => without(current, club.id));
    try {
      await work();
      setAnnouncement(done);
    } catch (error) {
      setErrors((current) => ({ ...current, [club.id]: workspaceErrorMessage(error) }));
    } finally {
      setWorking(null);
    }
  };

  return (
    <ClubDirectoryView
      workspaceName={organisation.name}
      clubs={directory.data ?? []}
      loading={directory.isPending}
      failed={directory.isError}
      onRetry={() => directory.refetch()}
      clubHref={(clubId) => `/o/${organisation.slug}?club=${clubId}`}
      working={working}
      errors={errors}
      announcement={announcement}
      onJoin={(club) => act(club, () => join.mutateAsync({ clubId: club.id }), `You're in ${club.name}.`)}
      onCancelRequest={(club) =>
        act(club, () => cancel.mutateAsync({ clubId: club.id }), `Took back your request to join ${club.name}.`)
      }
      asking={asking}
      onAskingChange={(club) => {
        setAsking(club);
        setMessage("");
      }}
      message={message}
      onMessageChange={setMessage}
      onAsk={async () => {
        if (!asking) return null;
        try {
          const result = await join.mutateAsync({ clubId: asking.id, message: message.trim() || undefined });
          setAnnouncement(
            result.status === "joined" ? `You're in ${asking.name}.` : `Asked to join ${asking.name}.`,
          );
          return null;
        } catch (error) {
          return workspaceErrorMessage(error);
        }
      }}
    />
  );
}
