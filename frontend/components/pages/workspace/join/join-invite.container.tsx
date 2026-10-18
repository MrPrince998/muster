"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { asApiError } from "@/lib/api/client";
import { useAcceptInvite, useInvitePreview } from "../services/invite.service";
import JoinInviteView from "./join-invite.view";

const ACCEPT_ERRORS: Record<string, string> = {
  INVITE_USED_UP: "Someone took the last place on this link just before you.",
  INVITE_EXPIRED: "This link expired a moment ago.",
  INVITE_REVOKED: "This link was just turned off.",
  INVITE_NOT_FOUND: "This link doesn't exist any more.",
  NETWORK_ERROR: "Can't reach Muster. Check your connection, then try again.",
};

/** /join/[code]: where an invite link lands. Shows where it leads, then joins. */
export default function JoinInviteContainer() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const preview = useInvitePreview(code);
  const accept = useAcceptInvite(code);
  const [error, setError] = useState<string | null>(null);
  // the link needs approval and they just asked
  const [requested, setRequested] = useState(false);

  const goTo = (slug: string, clubId: string) => router.replace(`/o/${slug}?club=${clubId}`);

  const onJoin = async () => {
    setError(null);
    try {
      const result = await accept.mutateAsync();
      if (result.status === "requested") setRequested(true);
      else goTo(result.workspaceSlug, result.clubId);
    } catch (failure) {
      const code = asApiError(failure).code;
      setError(ACCEPT_ERRORS[code] ?? "Couldn't join. Try again in a moment.");
    }
  };

  return (
    <JoinInviteView
      preview={preview.data ?? null}
      loading={preview.isPending}
      // 404: the code is wrong; anything else is a connection or server problem
      notFound={preview.isError && preview.error.code === "INVITE_NOT_FOUND"}
      failed={preview.isError && preview.error.code !== "INVITE_NOT_FOUND"}
      onRetry={() => preview.refetch()}
      joining={accept.isPending}
      waiting={requested || !!preview.data?.pendingRequest}
      error={error}
      onJoin={onJoin}
      onOpen={() => preview.data && goTo(preview.data.workspaceSlug, preview.data.clubId)}
    />
  );
}
