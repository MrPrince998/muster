"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { Answers, ClubEvent, TicketType } from "@/types/event.interface";
import { formatFullDate } from "../org-home/parts/format";
import { answerProblems, QuestionFields } from "../shared/question-fields";
import { TestCardNote } from "@/components/common/test-card-note";

export interface TicketChoice {
  answers?: Answers;
  ticketTypeId?: string;
  code?: string;
}

/** "Free", "$15.00": a ticket type's price as people read it. */
export const ticketPrice = (t: Pick<TicketType, "priceCents" | "currency">) =>
  t.priceCents === 0 || !t.currency ? "Free" : formatMoney(t.priceCents, t.currency);

/** What a type says under its name: how many are left, or why it isn't on sale. */
export function ticketNote(t: TicketType, timeZone?: string): string | null {
  if (t.remaining === 0) return "Sold out";
  if (t.salesEndAt && new Date(t.salesEndAt) <= new Date()) return "No longer on sale";
  const parts = [
    t.membersOnly ? "Members only" : null,
    t.salesEndAt ? `Until ${formatFullDate(t.salesEndAt, timeZone)}` : null,
    t.remaining !== null && t.remaining <= 10 ? `${t.remaining} left` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(". ") : null;
}

/**
 * Getting a ticket at an event with ticket types: which one, a discount
 * code (for a paid one), and the event's questions. For the waitlist, the
 * same without the code. A choice that costs something goes on to checkout.
 */
export function GetTicketDialog({
  event,
  open,
  onOpenChange,
  waitlist = false,
  timeZone,
  payDirectly = false,
  onConfirm,
}: {
  event: ClubEvent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  waitlist?: boolean;
  timeZone?: string;
  // paid to the organisers directly: the place is held while they pay, no Stripe
  payDirectly?: boolean;
  onConfirm: (choice: TicketChoice) => void;
}) {
  const types = event.ticketTypes;
  const firstOnSale = types.find((t) => t.onSale);
  const [typeId, setTypeId] = useState<string | undefined>(types.length === 1 || waitlist ? types[0]?.id : firstOnSale?.id);
  const [code, setCode] = useState("");
  const [answers, setAnswers] = useState<Answers>({});
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [typeProblem, setTypeProblem] = useState(false);
  const chosen = types.find((t) => t.id === typeId);
  const paid = !!chosen && chosen.priceCents > 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const found = answerProblems(event.questions, answers);
    setProblems(found);
    setTypeProblem(!chosen);
    if (!chosen || Object.keys(found).length > 0) return;
    onConfirm({
      ticketTypeId: chosen.id,
      ...(paid && code.trim() && !waitlist && { code: code.trim() }),
      answers: Object.fromEntries(
        Object.entries(answers)
          .map(([id, value]) => [id, value.trim()])
          .filter(([, value]) => value),
      ),
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-md">
        <form onSubmit={submit} noValidate className="space-y-5">
          <DialogHeader>
            <DialogTitle className="text-3xl leading-none font-extrabold font-stretch-70%">
              {waitlist ? "Join the waitlist" : "Get a ticket"}
            </DialogTitle>
            <DialogDescription>{event.title}</DialogDescription>
          </DialogHeader>

          {types.length > 1 && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Ticket</legend>
              <div className="space-y-2">
                {types.map((t) => {
                  const note = ticketNote(t, timeZone);
                  const disabled = !waitlist && !t.onSale;
                  return (
                    <label
                      key={t.id}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors has-checked:border-cobalt has-checked:bg-cobalt-50",
                        "has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                        disabled && "cursor-not-allowed opacity-60",
                      )}
                    >
                      <input
                        type="radio"
                        name="ticket-type"
                        value={t.id}
                        disabled={disabled}
                        checked={typeId === t.id}
                        onChange={() => setTypeId(t.id)}
                        className="mt-0.5 accent-cobalt"
                      />
                      <span className="flex-1">
                        <span className="block font-medium">{t.name}</span>
                        {note && <span className="text-muted-foreground">{note}</span>}
                      </span>
                      <span className="font-semibold tabular-nums">{ticketPrice(t)}</span>
                    </label>
                  );
                })}
              </div>
              {typeProblem && <p className="text-sm text-destructive">Choose a ticket</p>}
            </fieldset>
          )}

          {paid && !waitlist && (
            <div className="space-y-1.5">
              <label htmlFor="ticket-code" className="text-sm font-medium">
                Discount code <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <InputGroup className="h-11">
                <InputGroupInput
                  id="ticket-code"
                  value={code}
                  maxLength={30}
                  autoCapitalize="characters"
                  onChange={(e) => setCode(e.target.value)}
                />
              </InputGroup>
            </div>
          )}

          {event.questions.length > 0 && (
            <QuestionFields questions={event.questions} answers={answers} onChange={setAnswers} problems={problems} />
          )}

          {paid && !waitlist && !payDirectly && <TestCardNote />}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">
              {waitlist
                ? "Join the waitlist"
                : paid
                  ? payDirectly
                    ? `Hold my place, ${ticketPrice(chosen!)}`
                    : `Continue to pay ${ticketPrice(chosen!)}`
                  : "Get my ticket"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
