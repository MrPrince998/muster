const formatters = new Map<string, Intl.NumberFormat>();

/** "$15.00", "€8.50": a price in the currency's smallest unit, as people read it. */
export function formatMoney(amountCents: number, currency: string): string {
  const code = currency.toUpperCase();
  let formatter = formatters.get(code);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-GB", { style: "currency", currency: code, currencyDisplay: "narrowSymbol" });
    formatters.set(code, formatter);
  }
  // most currencies have cents; the few without (JPY) say so through their own digits
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(amountCents / 10 ** digits);
}

/** "15" or "15.50" from what someone typed, in cents; null when it isn't a price. */
export function parseMoney(text: string): number | null {
  const clean = text.trim().replace(/^[^\d]+/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}
