"use client";

import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";
import type { Answers, Question } from "@/types/event.interface";

/** What's missing or wrong, by question id; empty when the answers will do. */
export function answerProblems(questions: Question[], answers: Answers): Record<string, string> {
  const problems: Record<string, string> = {};
  for (const q of questions) {
    const value = (answers[q.id] ?? "").trim();
    if (q.required && !value) problems[q.id] = q.kind === "choice" ? "Choose one" : "Answer this one";
    else if (value.length > 300) problems[q.id] = "Use 300 characters or fewer";
  }
  return problems;
}

/**
 * An event's questions, for someone taking a place: a text box, or a row of
 * choices. Controlled: the answers live with whoever asks.
 */
export function QuestionFields({
  questions,
  answers,
  onChange,
  problems = {},
  idPrefix = "question",
}: {
  questions: Question[];
  answers: Answers;
  onChange: (answers: Answers) => void;
  problems?: Record<string, string>;
  idPrefix?: string;
}) {
  const set = (id: string, value: string) => onChange({ ...answers, [id]: value });
  return (
    <div className="space-y-4">
      {questions.map((q) => {
        const id = `${idPrefix}-${q.id}`;
        const problem = problems[q.id];
        const label = (
          <>
            {q.label}
            {!q.required && <span className="font-normal text-muted-foreground"> (optional)</span>}
          </>
        );
        return q.kind === "choice" ? (
          <fieldset key={q.id} className="space-y-2" aria-describedby={problem ? `${id}-problem` : undefined}>
            <legend className="text-sm font-medium">{label}</legend>
            <div className="flex flex-wrap gap-2">
              {q.options.map((option) => (
                <label
                  key={option}
                  className={cn(
                    "cursor-pointer rounded-full border px-3.5 py-1.5 text-sm transition-colors has-checked:border-cobalt has-checked:bg-cobalt-50 has-checked:text-cobalt-800",
                    "has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                  )}
                >
                  <input
                    type="radio"
                    name={id}
                    value={option}
                    checked={answers[q.id] === option}
                    onChange={() => set(q.id, option)}
                    className="sr-only"
                  />
                  {option}
                </label>
              ))}
            </div>
            {problem && (
              <p id={`${id}-problem`} className="text-sm text-destructive">
                {problem}
              </p>
            )}
          </fieldset>
        ) : (
          <div key={q.id} className="space-y-1.5">
            <label htmlFor={id} className="text-sm font-medium">
              {label}
            </label>
            <InputGroup className="h-11">
              <InputGroupInput
                id={id}
                value={answers[q.id] ?? ""}
                maxLength={300}
                aria-invalid={!!problem}
                onChange={(e) => set(q.id, e.target.value)}
              />
            </InputGroup>
            {problem && <p className="text-sm text-destructive">{problem}</p>}
          </div>
        );
      })}
    </div>
  );
}
