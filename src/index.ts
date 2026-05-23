import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import { extractNumbers, Extracted } from './vision';
import { applyOperation, initState, MathState } from './math';
import { summarizeExtraction } from './format';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(
  express.json({
    limit: '10mb',
    verify: (req: any, _res, buf) => { req.rawBody = buf; },
  })
);

app.post('/mcp', async (req: Request, res: Response) => {
  const { jsonrpc, method, params, id } = req.body;
  if (jsonrpc !== '2.0') return res.status(400).send('Invalid JSON-RPC');

  if (method === 'tools/list') {
    return res.json({
      jsonrpc: '2.0',
      id,
      result: {
        tools: [
          {
            name: 'handle_dialog',
            description: 'Reads numbers from photos and does math: totals, splits, tips, taxes, discounts.',
            inputSchema: {
              type: 'object',
              properties: { utterance: { type: 'string' } },
            },
          },
        ],
      },
    });
  }

  if (method === 'tools/call') {
    const args = params?.arguments || {};
    try {
      const result = await handleDialog(args);
      return res.json({ jsonrpc: '2.0', id, result });
    } catch (err: any) {
      console.error('[handle_dialog] error:', err?.message || err);
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: `Something went wrong reading the photo. Try again.` }],
        },
      });
    }
  }

  res.status(404).json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
});

interface DialogArgs {
  utterance?: string;
  items?: Array<{ url?: string; mimeType?: string }>;
  pending_context?: {
    context_key?: string;
    context_payload?: { state?: MathState };
  } | null;
}

async function handleDialog(args: DialogArgs) {
  const utterance = (args.utterance || '').trim();
  const pending = args.pending_context;

  if (pending?.context_key === 'bill_math' && pending.context_payload?.state) {
    const result = applyOperation(pending.context_payload.state, utterance);
    if (result.done || !result.state) {
      return { content: [{ type: 'text', text: result.text }] };
    }
    return buildAwaitResponse(result.text, result.state);
  }

  const imageItem = (args.items || []).find((i) => i?.url && (i.mimeType || '').startsWith('image/'));
  if (!imageItem?.url) {
    return {
      content: [{
        type: 'text',
        text: `Take a photo of the bill, receipt, or price list and I'll do the math.`,
      }],
    };
  }

  const extracted = await extractNumbers(imageItem.url);
  const summary = summarizeExtraction(extracted);

  if (extracted.items.length === 0) {
    return { content: [{ type: 'text', text: summary }] };
  }

  const state = initState(extracted);
  return buildAwaitResponse(summary, state);
}

function buildAwaitResponse(spoken: string, state: MathState) {
  return {
    content: [
      { type: 'text', text: spoken },
      {
        type: 'embedded_responses',
        responses: [
          {
            type: 'await_input',
            content: {
              question: 'What do you want to do? (split, tip, tax, discount, or done)',
              context_key: 'bill_math',
              context_payload: { state },
              timeout_ms: 120000,
            },
          },
        ],
      },
    ],
    state: 'awaiting_input',
  };
}

app.post('/delete-user', (req: Request, res: Response) => {
  const { user_id } = req.body;
  console.log(`[Cleanup] Deleting data for user ${user_id}`);
  res.json({ ok: true });
});

app.get('/', (_req, res) => res.send('Bill Math skill running'));

app.listen(PORT, () => {
  console.log(`Bill Math skill running at http://localhost:${PORT}`);
});
