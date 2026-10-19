"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Answers, ClubEvent } from "@/types/event.interface";
import { answerProblems, QuestionFields } from "../shared/question-fields";

/**
 * The event's questions, asked before taking a place (registering, buying,
 * or joining the waitlist). `confirmLabel` says what happens next.
 */
export function AnswersDialog({
  event,
  open,
  onOpenChange,
  confirmLabel,
  onConfirm,
}: {
  event: ClubEvent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  confirmLabel: string;
  onConfirm: (answers: Answers) => void;
}) {
  const [answers, setAnswers] = useState<Answers>({});
  const [problems, setProblems] = useState<Record<string, string>>({});

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const found = answerProblems(event.questions, answers);
    setProblems(found);
    if (Object.keys(found).length > 0) return;
    onConfirm(Object.fromEntries(Object.entries(answers).map(([id, value]) => [id, value.trim()]).filter(([, value]) => value)));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-md">
        <form onSubmit={submit} noValidate className="space-y-5">
          <DialogHeader>
            <DialogTitle className="text-3xl leading-none font-extrabold font-stretch-70%">A few questions</DialogTitle>
            <DialogDescription>The organisers of {event.title} would like to know.</DialogDescription>
          </DialogHeader>
          <QuestionFields questions={event.questions} answers={answers} onChange={setAnswers} problems={problems} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">{confirmLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
