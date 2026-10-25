"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { asApiError } from "@/lib/api/client";
import { useClubLinkPreview, useJoinByClubLink } from "../services/club-directory.service";
import ClubLinkView from "./club-link.view";

const JOIN_ERRORS: Record<string, string> = {
  CLUB_NOT_FOUND: "This club now takes invite links only. Ask someone in it for one.",
  CLUB_INVITE_ONLY: "This club now takes invite links only. Ask someone in it for one.",
  REQUEST_PENDING: "You've already asked to join this workspace. Its moderators will decide.",
  REQUEST_RECENTLY_REJECTED: "Your last request to join this workspace was declined. Try again tomorrow.",
  NETWORK_ERROR: "Can't reach Muster. Check your connection, then try again.",
};

/** /c/[slug]/[clubSlug]: a club's own link. Shows the club, then joins it (or asks). */
export default function ClubLinkContainer() {
  const { slug, clubSlug } = useParams<{ slug: string; clubSlug: string }>();
  const router = useRouter();
  const preview = useClubLinkPreview(slug, clubSlug);
  const join = useJoinByClubLink(slug, clubSlug);
  const [sent, setSent] = useState<"club" | "workspace" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  const goTo = (workspaceSlug: string, clubId: string) => router.replace(`/o/${workspaceSlug}?club=${clubId}`);

  const onJoin = async () => {
    setError(null);
    try {
      const result = await join.mutateAsync({ message: message.trim() || undefined });
      if (result.status === "joined") goTo(result.workspaceSlug, result.clubId);
      else setSent(result.status === "requested" ? "club" : "workspace");
    } catch (failure) {
      const code = asApiError(failure).code;
      // already in: go there
      if (code === "ALREADY_IN_CLUB" && preview.data) return goTo(preview.data.workspaceSlug, preview.data.clubId);
      setError(JOIN_ERRORS[code] ?? "Couldn't join. Try again in a moment.");
    }
  };

  return (
    <ClubLinkView
      preview={preview.data ?? null}
      loading={preview.isPending}
      notFound={preview.isError && preview.error.code === "CLUB_NOT_FOUND"}
      failed={preview.isError && preview.error.code !== "CLUB_NOT_FOUND"}
      onRetry={() => preview.refetch()}
      joining={join.isPending}
      sent={sent}
      message={message}
      onMessageChange={setMessage}
      error={error}
      onJoin={onJoin}
      onOpen={() => preview.data && goTo(preview.data.workspaceSlug, preview.data.clubId)}
    />
  );
}
