const SYMBOLS: Record<string, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
};

export function formatMoney(value: number, currency: string | null | undefined): string {
  const sym = currency && SYMBOLS[currency] ? SYMBOLS[currency] : SYMBOLS.INR;
  const rounded = Math.round(value * 100) / 100;
  const fixed = Number.isInteger(rounded) ? rounded.toString() : rounded.toFixed(2);
  return `${sym}${fixed}`;
}

export function summarizeExtraction(
  extracted: { items: number[]; total: number | null; currency: string | null },
): string {
  const { items, total, currency } = extracted;

  if (items.length === 0) {
    return `I couldn't read any numbers clearly. Try again with better light or a steadier angle.`;
  }

  if (total != null) {
    return `I see a bill with ${items.length} ${items.length === 1 ? 'item' : 'items'} totaling ${formatMoney(total, currency)}. What do you want to do?`;
  }

  if (items.length === 1) {
    return `I see ${formatMoney(items[0], currency)}. What do you want to do?`;
  }

  const sum = items.reduce((a, b) => a + b, 0);
  return `I see ${items.length} numbers adding up to ${formatMoney(sum, currency)}. What do you want to do?`;
}
