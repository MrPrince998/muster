import type { AnswerTally, ClubEvent } from "@/types/event.interface";

/**
 * What the people going said, at a glance: each choice question's tally
 * (for the caterer, the T-shirt order), and how many answered the text ones.
 * Counted by the API over everyone going; each person's answers are in the
 * spreadsheet.
 */
export function AnswersSummary({ event, total, tallies }: { event: ClubEvent; total: number; tallies: AnswerTally[] }) {
  if (event.questions.length === 0 || total === 0) return null;
  return (
    <section aria-label="Answers" className="space-y-3">
      <h3 className="text-sm font-semibold">What they said</h3>
      {event.questions.map((q) => {
        const tally = tallies.find((t) => t.questionId === q.id);
        return (
          <div key={q.id} className="text-sm">
            <p className="font-medium">{q.label}</p>
            {q.kind === "choice" ? (
              <ul className="mt-1 space-y-0.5">
                {q.options.map((option) => (
                  <li key={option} className="flex justify-between gap-4 text-muted-foreground">
                    <span>{option}</span>
                    <span className="font-semibold text-foreground tabular-nums">{tally?.options[option] ?? 0}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">
                {tally?.answered ?? 0} of {total} answered. Their answers are in the spreadsheet.
              </p>
            )}
          </div>
        );
      })}
    </section>
  );
}
