"use client";

import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { asApiError } from "@/lib/api/client";
import { formatMoney, parseMoney } from "@/lib/money";
import type { ClubEvent, DiscountCode } from "@/types/event.interface";
import { useCreateDiscountCode, useDiscountCodes, useSetDiscountCode } from "../services/event.service";

// "50% off", "$5.00 off"
function off(code: DiscountCode, currency: string): string {
  return code.percentOff !== null ? `${code.percentOff}% off` : `${formatMoney(code.amountOffCents ?? 0, currency)} off`;
}

/**
 * An event's discount codes: what each takes off, how often it's been used,
 * on or off; and a form for a new one.
 */
export function DiscountCodesDialog({
  event,
  open,
  onOpenChange,
}: {
  event: ClubEvent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const codes = useDiscountCodes(event.clubId, event.id, open);
  const create = useCreateDiscountCode(event.clubId, event.id);
  const toggle = useSetDiscountCode(event.clubId, event.id);
  const currency = event.price?.currency ?? "aud";
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<"percent" | "amount">("percent");
  const [amount, setAmount] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const value = kind === "percent" ? Number(amount) : parseMoney(amount);
    if (!/^[A-Za-z0-9-]{3,30}$/.test(code.trim())) return setError("A code is 3 to 30 letters, digits or dashes.");
    if (!value || (kind === "percent" && (value < 1 || value > 100))) {
      return setError(kind === "percent" ? "Take 1 to 100 percent off." : "Enter an amount to take off.");
    }
    if (maxUses && !(Number(maxUses) >= 1)) return setError("Uses is a whole number, 1 or more, or empty for no limit.");
    try {
      await create.mutateAsync({
        code: code.trim(),
        ...(kind === "percent" ? { percentOff: value } : { amountOffCents: value }),
        ...(maxUses && { maxUses: Number(maxUses) }),
      });
      setCode("");
      setAmount("");
      setMaxUses("");
    } catch (failure) {
      setError(
        asApiError(failure).code === "CODE_TAKEN"
          ? "This event already has that code."
          : "Couldn't make the code. Try again in a moment.",
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-3xl leading-none font-extrabold font-stretch-70%">Discount codes</DialogTitle>
          <DialogDescription>Money off {event.title}&rsquo;s paid tickets, for whoever has the code.</DialogDescription>
        </DialogHeader>

        {(codes.data?.length ?? 0) > 0 && (
          <ul className="divide-y rounded-lg border">
            {codes.data!.map((c) => (
              <li key={c.id} className="flex items-center gap-3 p-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className={c.active ? "font-semibold" : "font-semibold text-muted-foreground line-through"}>{c.code}</span>{" "}
                  <span className="text-muted-foreground">
                    {off(c, currency)}, used {c.uses}
                    {c.maxUses !== null ? ` of ${c.maxUses}` : ""}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={toggle.isPending}
                  onClick={() => toggle.mutate({ codeId: c.id, active: !c.active })}
                >
                  {c.active ? "Turn off" : "Turn on"}
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={submit} className="space-y-3 border-t pt-4">
          <h3 className="text-sm font-semibold">New code</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <InputGroup className="h-10">
              <InputGroupInput
                aria-label="Code"
                placeholder="EARLYBIRD"
                value={code}
                maxLength={30}
                autoCapitalize="characters"
                onChange={(e) => setCode(e.target.value)}
              />
            </InputGroup>
            <div className="flex gap-2">
              <select
                aria-label="Kind of discount"
                value={kind}
                onChange={(e) => setKind(e.target.value as "percent" | "amount")}
                className="h-10 rounded-lg border border-input bg-transparent px-2 text-sm"
              >
                <option value="percent">% off</option>
                <option value="amount">{currency.toUpperCase()} off</option>
              </select>
              <InputGroup className="h-10 flex-1">
                <InputGroupInput
                  aria-label={kind === "percent" ? "Percent off" : "Amount off"}
                  inputMode="decimal"
                  placeholder={kind === "percent" ? "20" : "5.00"}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </InputGroup>
            </div>
          </div>
          <InputGroup className="h-10 sm:max-w-56">
            <InputGroupInput
              aria-label="Most uses"
              inputMode="numeric"
              placeholder="Any number of uses"
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
            />
          </InputGroup>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" disabled={create.isPending}>
            {create.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
            Make code
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
