import type { ClubEvent, EventAttendee } from "@/types/event.interface";

/**
 * What the people going said, at a glance: each choice question's tally
 * (for the caterer, the T-shirt order), and how many answered the text ones.
 * Each person's answers are in the spreadsheet.
 */
export function AnswersSummary({ event, attendees }: { event: ClubEvent; attendees: EventAttendee[] }) {
  if (event.questions.length === 0 || attendees.length === 0) return null;
  return (
    <section aria-label="Answers" className="space-y-3">
      <h3 className="text-sm font-semibold">What they said</h3>
      {event.questions.map((q) => {
        const given = attendees.map((a) => a.answers?.[q.id]).filter((v): v is string => !!v);
        return (
          <div key={q.id} className="text-sm">
            <p className="font-medium">{q.label}</p>
            {q.kind === "choice" ? (
              <ul className="mt-1 space-y-0.5">
                {q.options.map((option) => (
                  <li key={option} className="flex justify-between gap-4 text-muted-foreground">
                    <span>{option}</span>
                    <span className="font-semibold text-foreground tabular-nums">
                      {given.filter((v) => v === option).length}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">
                {given.length} of {attendees.length} answered. Their answers are in the spreadsheet.
              </p>
            )}
          </div>
        );
      })}
    </section>
  );
}
