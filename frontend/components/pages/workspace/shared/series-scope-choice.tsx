import { cn } from "@/lib/utils";
import type { ClubEvent, SeriesScope } from "@/types/event.interface";

/** Whether this event has later ones in its series, so "this and following" means something. */
export const hasLaterInSeries = (event: ClubEvent | null | undefined) =>
  !!event?.series && event.series.index < event.series.count;

/**
 * For an event that repeats: change just this one, or this and the ones
 * after it. `verb` finishes the question: "Which events do you want to <verb>?"
 */
export function SeriesScopeChoice({
  value,
  onChange,
  verb,
  name = "series-scope",
}: {
  value: SeriesScope;
  onChange: (scope: SeriesScope) => void;
  verb: string;
  name?: string;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">This event repeats. Which ones do you want to {verb}?</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {(
          [
            ["this", "This event", "The others stay as they are."],
            ["following", "This and following", "This one and every later one in the series."],
          ] as const
        ).map(([scope, label, hint]) => (
          <label
            key={scope}
            className={cn(
              "flex cursor-pointer gap-2.5 rounded-lg border p-3 text-sm transition-colors has-checked:border-cobalt has-checked:bg-cobalt-50",
              "has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
            )}
          >
            <input
              type="radio"
              name={name}
              value={scope}
              checked={value === scope}
              onChange={() => onChange(scope)}
              className="mt-0.5 accent-cobalt"
            />
            <span>
              <span className="block font-medium">{label}</span>
              <span className="text-muted-foreground">{hint}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const every = { week: "week", fortnight: "fortnight", month: "month" } as const;

/** "Every week, 2 of 8" */
export const seriesLabel = (series: NonNullable<ClubEvent["series"]>) =>
  `Every ${every[series.every]}, ${series.index} of ${series.count}`;
