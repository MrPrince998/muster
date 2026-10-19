"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { stubParts } from "../workspace/org-home/parts/format";
import { forgetRecent, readRecent, rememberPick, type RecentPick } from "./parts/recent-searches";
import SearchDialogView, { firstRowValue, type SearchState } from "./search-dialog.view";
import { SEARCH_MIN_LENGTH, useSearch } from "./services/search.service";

// a request per pause in typing, not per keypress
function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/** Search (⌘K): owns the text, the request, the recent picks, and where each result goes. */
export default function SearchDialogContainer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [recent, setRecent] = useState<RecentPick[]>([]);
  const query = useDebounced(text, 180);
  const search = useSearch(query);

  const [selected, setSelected] = useState("");
  const [shownFirst, setShownFirst] = useState("");

  // every time it opens: an empty box, the recent picks fresh from storage,
  // and the top row highlighted again
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setText("");
      setRecent(readRecent());
      setShownFirst("");
    }
  }

  const trimmed = text.trim();
  const state: SearchState =
    trimmed.length === 0
      ? { kind: "idle" }
      : trimmed.length < SEARCH_MIN_LENGTH
        ? { kind: "too-short" }
        : search.data
          ? { kind: "results", result: search.data, refreshing: search.isFetching || query.trim() !== trimmed }
          : search.isError
            ? { kind: "failed" }
            : { kind: "loading" };

  // new results: highlight the top one
  const first = firstRowValue(state, recent);
  if (first !== shownFirst) {
    setShownFirst(first);
    setSelected(first);
  }

  const go = (pick: RecentPick) => {
    rememberPick(pick);
    onOpenChange(false);
    router.push(pick.href);
  };

  return (
    <SearchDialogView
      open={open}
      onOpenChange={onOpenChange}
      text={text}
      onTextChange={setText}
      selected={selected}
      onSelectedChange={setSelected}
      state={state}
      recent={recent}
      onClearRecent={() => {
        forgetRecent();
        setRecent([]);
      }}
      onPickRecent={go}
      onPickWorkspace={(hit) =>
        go({ key: `workspace:${hit.orgId}`, kind: "workspace", label: hit.name, detail: "Workspace", href: `/o/${hit.slug}` })
      }
      onPickClub={(hit) =>
        go({
          key: `club:${hit.id}`,
          kind: "club",
          label: hit.name,
          detail: `Club in ${hit.orgName}`,
          href: `/o/${hit.orgSlug}?club=${hit.id}`,
        })
      }
      onPickEvent={(hit) => {
        const { day, month } = stubParts(hit.startsAt, hit.timeZone);
        go({
          key: `event:${hit.id}`,
          kind: "event",
          label: hit.title,
          detail: `${day} ${month}, ${hit.clubName}`,
          href: `/o/${hit.orgSlug}?club=${hit.clubId}&event=${hit.id}`,
        });
      }}
      onPickPerson={(hit) =>
        go({
          key: `person:${hit.orgSlug}:${hit.userId}`,
          kind: "person",
          label: hit.name,
          detail: `Member of ${hit.orgName}`,
          href: `/o/${hit.orgSlug}/members?q=${encodeURIComponent(hit.name)}`,
        })
      }
    />
  );
}
