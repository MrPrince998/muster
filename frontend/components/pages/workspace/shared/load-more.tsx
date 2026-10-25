"use client";

import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The button under a paged list: the next page, with how many there are in all when that's known. */
export function LoadMore({
  shown,
  total,
  loading,
  onMore,
}: {
  shown: number;
  // null while searching: the total counts everyone, not the matches
  total: number | null;
  loading: boolean;
  onMore: () => void;
}) {
  const left = total === null ? 0 : Math.max(0, total - shown);
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <Button variant="outline" onClick={onMore} disabled={loading}>
        {loading && <LoaderCircle className="animate-spin" aria-hidden />}
        {loading ? "Loading…" : "Load more"}
      </Button>
      {left > 0 && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          Showing {shown} of {total}
        </p>
      )}
    </div>
  );
}
