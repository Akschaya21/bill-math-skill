import { GoogleGenerativeAI } from '@google/generative-ai';

export interface Extracted {
  items: number[];
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  currency: string | null;
  confidence: 'high' | 'medium' | 'low';
}

const PROMPT = `You are a number-extraction agent. The image shows printed numbers — could be a bill, receipt, price tags, or a list of prices. Return ONLY valid JSON in this exact shape:

{
  "items": [number, ...],
  "subtotal": number | null,
  "tax": number | null,
  "total": number | null,
  "currency": "INR" | "USD" | "EUR" | "GBP" | null,
  "confidence": "high" | "medium" | "low"
}

Rules:
- "items" = every individual line-item value you can read.
- Only populate "subtotal", "tax", "total" when those labels are explicitly visible.
- If only one number is visible, put it in "items".
- If you cannot read any numbers, return {"items": [], "subtotal": null, "tax": null, "total": null, "currency": null, "confidence": "low"}.
- Do NOT include any text outside the JSON.`;

export async function extractNumbers(imageUrl: string): Promise<Extracted> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`image fetch failed: ${imgRes.status}`);
  const mimeType = imgRes.headers.get('content-type') || 'image/jpeg';
  const buf = Buffer.from(await imgRes.arrayBuffer());
  const base64 = buf.toString('base64');

  const genai = new GoogleGenerativeAI(apiKey);
  const model = genai.getGenerativeModel({
    model: 'gemini-2.0-flash',
    generationConfig: { responseMimeType: 'application/json' },
  });
  const result = await model.generateContent([
    { inlineData: { mimeType, data: base64 } },
    { text: PROMPT },
  ]);
  const text = result.response.text();
  const parsed = JSON.parse(text) as Extracted;
  parsed.items = (parsed.items || []).filter((n) => typeof n === 'number' && isFinite(n));
  return parsed;
}
