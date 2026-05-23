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

// ─── Number-word normalization ────────────────────────────────────────────────

const NUMBER_WORDS_BELOW_20: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19,
};
const NUMBER_WORDS_TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
};

function normalizeNumberWords(text: string): string {
  let t = text;
  // "twenty-five", "twenty five" → 25
  t = t.replace(
    /\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-]+(one|two|three|four|five|six|seven|eight|nine)\b/gi,
    (_m, tens: string, ones: string) =>
      String(NUMBER_WORDS_TENS[tens.toLowerCase()] + NUMBER_WORDS_BELOW_20[ones.toLowerCase()]),
  );
  // standalone tens
  t = t.replace(
    /\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/gi,
    (_m, w: string) => String(NUMBER_WORDS_TENS[w.toLowerCase()]),
  );
  // below 20
  t = t.replace(
    /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)\b/gi,
    (_m, w: string) => String(NUMBER_WORDS_BELOW_20[w.toLowerCase()]),
  );
  // simple "X hundred" / "X thousand" → X*100 / X*1000
  t = t.replace(/\b(\d+)\s+hundred\b/gi, (_m, n: string) => String(parseInt(n, 10) * 100));
  t = t.replace(/\b(\d+)\s+thousand\b/gi, (_m, n: string) => String(parseInt(n, 10) * 1000));
  return t;
}

function normalize(u: string): string {
  return normalizeNumberWords(u.toLowerCase().trim());
}

// ─── Intent detection (keyword + nearest number) ──────────────────────────────

const DONE_RE = /\b(done|that'?s all|nothing else|no thanks?|stop|end|exit|cancel|finish(ed)?|that'?s it|good)\b/i;
const TOTAL_RE = /\b(total|sum|grand total|how much|add (?:it|them)(?: up)?|whole(?: thing)?)\b/i;
const TIP_RE = /\b(tip|gratuity)\b/i;
const TAX_RE = /\b(tax|gst|vat)\b/i;
const DISCOUNT_RE = /\b(off|discount|deduct)\b/i;
const SPLIT_RE = /\b(split|divide|ways?|people|persons?|between|among|each)\b/i;

interface NumberHit { value: number; index: number; }

function allNumbers(u: string): NumberHit[] {
  const hits: NumberHit[] = [];
  const re = /\d+(?:\.\d+)?/g;
  let m;
  while ((m = re.exec(u)) !== null) {
    hits.push({ value: parseFloat(m[0]), index: m.index });
  }
  return hits;
}

function nearestTo(u: string, keywordRe: RegExp): number | null {
  const km = u.match(keywordRe);
  if (!km || km.index == null) return null;
  const nums = allNumbers(u);
  if (nums.length === 0) return null;
  nums.sort((a, b) => Math.abs(a.index - km.index!) - Math.abs(b.index - km.index!));
  return nums[0].value;
}

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

// ─── Public helpers used by index.ts ──────────────────────────────────────────

export function extractNumbersFromUtterance(u: string): number[] {
  const cleaned = normalize(u)
    .replace(/(\d+(?:\.\d+)?)\s*%/g, ' ')
    .replace(/\b(\d+)\s*(people|ways?|persons?)\b/gi, ' ');
  return allNumbers(cleaned).map((h) => h.value);
}

export function looksLikeMathRequest(u: string): boolean {
  const n = normalize(u);
  return TOTAL_RE.test(n) || TIP_RE.test(n) || TAX_RE.test(n) || DISCOUNT_RE.test(n) || SPLIT_RE.test(n);
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

// ─── Main: apply one (or compound) operation ──────────────────────────────────

export function applyOperation(state: MathState, utterance: string): MathResult {
  const u = normalize(utterance);
  const currency = state.extracted.currency;

  if (DONE_RE.test(u)) {
    return { text: `Got it. ${formatMoney(state.running_total, currency)} final.`, done: true };
  }

  let value = state.running_total;
  const parts: string[] = [];
  let matched = false;

  // 1. Reset to base if user explicitly says "total"
  if (TOTAL_RE.test(u)) {
    value = baseTotal(state.extracted);
    parts.push(`Total: ${formatMoney(value, currency)}`);
    matched = true;
  }

  // 2. Tip — nearest number to "tip" keyword
  if (TIP_RE.test(u)) {
    const pct = nearestTo(u, TIP_RE);
    if (pct != null) {
      value = value * (1 + pct / 100);
      parts.push(`With ${pct}% tip: ${formatMoney(value, currency)}`);
      matched = true;
    }
  }

  // 3. Tax / GST / VAT
  if (TAX_RE.test(u)) {
    const pct = nearestTo(u, TAX_RE);
    if (pct != null) {
      value = value * (1 + pct / 100);
      const label = /gst/i.test(u) ? 'GST' : /vat/i.test(u) ? 'VAT' : 'tax';
      parts.push(`With ${pct}% ${label}: ${formatMoney(value, currency)}`);
      matched = true;
    }
  }

  // 4. Discount
  if (DISCOUNT_RE.test(u)) {
    const pct = nearestTo(u, DISCOUNT_RE);
    if (pct != null) {
      value = value * (1 - pct / 100);
      parts.push(`After ${pct}% off: ${formatMoney(value, currency)}`);
      matched = true;
    }
  }

  // 5. Split — pick the smallest integer near the split keyword
  if (SPLIT_RE.test(u)) {
    const km = u.match(SPLIT_RE);
    const nums = allNumbers(u);
    const splitCandidates = nums
      .filter((h) => Number.isInteger(h.value) && h.value >= 1 && h.value <= 100);
    if (splitCandidates.length > 0 && km?.index != null) {
      splitCandidates.sort((a, b) => Math.abs(a.index - km.index!) - Math.abs(b.index - km.index!));
      const n = splitCandidates[0].value;
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
    history: [...state.history, utterance],
  };

  return {
    text: parts.join('. ') + '. What next?',
    done: false,
    state: nextState,
  };
}
