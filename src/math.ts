import { Extracted } from './vision';
import { formatMoney } from './format';

export interface MathState {
  extracted: Extracted;
  running_total: number;
  history: string[];
}

export interface MathResult {
  text: string;
  done: boolean;
  state?: MathState;
}

const DONE_RE = /^(done|that'?s all|nothing|no thanks?|stop|end|exit|cancel|finish(ed)?)\b/i;
const TOTAL_RE = /\b(total|sum|add (it|them)( up)?|grand total|how much)\b/i;
const SPLIT_RE = /split\s+(?:by\s+|across\s+|among\s+|between\s+)?(\d+)|divide\s+(?:by\s+)?(\d+)|(\d+)\s+ways?|(\d+)\s+people/i;
const TIP_RE = /(\d+(?:\.\d+)?)\s*%?\s*(tip|gratuity)/i;
const TAX_RE = /(\d+(?:\.\d+)?)\s*%?\s*(gst|tax|vat)/i;
const DISCOUNT_RE = /(\d+(?:\.\d+)?)\s*%?\s*(off|discount)/i;

function baseTotal(e: Extracted): number {
  if (e.total != null) return e.total;
  if (e.subtotal != null) return e.subtotal;
  return e.items.reduce((a, b) => a + b, 0);
}

export function initState(extracted: Extracted): MathState {
  return {
    extracted,
    running_total: baseTotal(extracted),
    history: [],
  };
}

const OP_HINT_RE = /\b(tip|gratuity|gst|tax|vat|off|discount|split|divide|total|sum|between|among|ways?)\b/i;

export function extractNumbersFromUtterance(u: string): number[] {
  const cleaned = u
    .replace(/(\d+(?:\.\d+)?)\s*%/g, ' ')
    .replace(/\b(\d+)\s*(people|ways?|persons?)\b/gi, ' ');
  const matches = cleaned.match(/\d+(?:\.\d+)?/g) || [];
  return matches.map((m) => parseFloat(m)).filter((n) => isFinite(n));
}

export function looksLikeMathRequest(u: string): boolean {
  return OP_HINT_RE.test(u);
}

export function buildStateFromUtterance(u: string): MathState | null {
  const nums = extractNumbersFromUtterance(u);
  if (nums.length === 0) return null;
  return initState({
    items: nums,
    subtotal: null,
    tax: null,
    total: null,
    currency: null,
    confidence: 'high',
  });
}

export function applyOperation(state: MathState, utterance: string): MathResult {
  const u = utterance.trim();
  const currency = state.extracted.currency;

  if (DONE_RE.test(u)) {
    return { text: `Got it. ${formatMoney(state.running_total, currency)} final.`, done: true };
  }

  let value = state.running_total;
  const parts: string[] = [];
  let matched = false;

  if (TOTAL_RE.test(u)) {
    value = baseTotal(state.extracted);
    parts.push(`Total: ${formatMoney(value, currency)}`);
    matched = true;
  }

  const tipM = u.match(TIP_RE);
  if (tipM) {
    const pct = parseFloat(tipM[1]);
    value = value * (1 + pct / 100);
    parts.push(`With ${pct}% tip: ${formatMoney(value, currency)}`);
    matched = true;
  }

  const taxM = u.match(TAX_RE);
  if (taxM) {
    const pct = parseFloat(taxM[1]);
    value = value * (1 + pct / 100);
    const label = /gst/i.test(taxM[2]) ? 'GST' : taxM[2].toLowerCase();
    parts.push(`With ${pct}% ${label}: ${formatMoney(value, currency)}`);
    matched = true;
  }

  const discM = u.match(DISCOUNT_RE);
  if (discM) {
    const pct = parseFloat(discM[1]);
    value = value * (1 - pct / 100);
    parts.push(`After ${pct}% off: ${formatMoney(value, currency)}`);
    matched = true;
  }

  const splitM = u.match(SPLIT_RE);
  if (splitM) {
    const n = parseInt(splitM[1] || splitM[2] || splitM[3] || splitM[4], 10);
    if (n > 0) {
      const per = value / n;
      parts.push(`Each of ${n} pays ${formatMoney(per, currency)}`);
      matched = true;
    }
  }

  if (!matched) {
    return {
      text: `I didn't catch that. Try "split by 4", "add 18% tip", "20% off", or "done".`,
      done: false,
      state,
    };
  }

  const nextState: MathState = {
    ...state,
    running_total: value,
    history: [...state.history, u],
  };

  return {
    text: parts.join('. ') + '. What next?',
    done: false,
    state: nextState,
  };
}
