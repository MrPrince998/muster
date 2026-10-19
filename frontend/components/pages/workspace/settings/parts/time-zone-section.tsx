"use client";

import { Check, LoaderCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { asApiError } from "@/lib/api/client";
import { deviceZone, zoneCity } from "@/lib/time-zone";
import { useUpdateOrganisation } from "../../services/organisation.service";

// "GMT+11:00" right now, for the list
function offsetLabel(zone: string): string {
  const name =
    new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
      .formatToParts(new Date())
      .find((part) => part.type === "timeZoneName")?.value ?? "";
  return name === "GMT" ? "GMT+0" : name;
}

/**
 * Where the workspace's clubs meet. Every event time, in the app, in emails
 * and in link previews, is shown on this clock, whoever is looking.
 */
export function TimeZoneSection({ orgId, current }: { orgId: string; current: string }) {
  const update = useUpdateOrganisation(orgId);
  const [choice, setChoice] = useState(current);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const device = deviceZone();

  const zones = useMemo(() => {
    const all = Intl.supportedValuesOf("timeZone");
    // the current one is always there to see, even if this browser's list lacks it (e.g. "UTC")
    const list = all.includes(current) ? all : [current, ...all];
    return list.map((zone) => ({ zone, label: `${zone.replace(/_/g, " ")} (${offsetLabel(zone)})` }));
  }, [current]);

  const save = async () => {
    setError(null);
    setSaved(false);
    try {
      await update.mutateAsync({ timeZone: choice });
      setSaved(true);
    } catch (failure) {
      setError(
        asApiError(failure).code === "VALIDATION_ERROR"
          ? "That time zone isn't recognised. Pick one from the list."
          : "Couldn't save it. Try again in a moment.",
      );
    }
  };

  return (
    <section aria-labelledby="time-zone-heading" className="space-y-4 border-b py-10">
      <div>
        <h2 id="time-zone-heading" className="text-xl font-bold font-stretch-80%">
          Time zone
        </h2>
        <p className="mt-1 max-w-prose text-muted-foreground">
          Where your clubs meet. Event times are shown and emailed on this clock, so an event at 18:30 reads 18:30
          for everyone, wherever they are.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="workspace-time-zone" className="sr-only">
          Time zone
        </label>
        <select
          id="workspace-time-zone"
          value={choice}
          onChange={(event) => {
            setChoice(event.target.value);
            setSaved(false);
          }}
          className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:max-w-md"
        >
          {zones.map(({ zone, label }) => (
            <option key={zone} value={zone}>
              {label}
            </option>
          ))}
        </select>
        <Button className="h-11 px-4" onClick={save} disabled={choice === current || update.isPending}>
          {update.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
          {update.isPending ? "Saving…" : "Save time zone"}
        </Button>
      </div>
      {choice !== device && (
        <button
          type="button"
          onClick={() => {
            setChoice(device);
            setSaved(false);
          }}
          className="text-sm font-medium text-cobalt underline-offset-4 hover:underline"
        >
          Use this device&rsquo;s zone ({zoneCity(device)})
        </button>
      )}
      <div role="status">
        {saved && (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Check className="size-4 text-cobalt" aria-hidden />
            Saved. Times now show in {zoneCity(current)} time.
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </section>
  );
}
