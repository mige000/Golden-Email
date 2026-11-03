import { ApiError, FinishReason, GoogleGenAI, ThinkingLevel } from '@google/genai';
import express from 'express';
import { z } from 'zod';
import { SEGMENT_IDS } from '../client/src/lib/types';

// Everything the client may send: segment-level facts only, every field bounded.
export const DraftRequestSchema = z
  .object({
    businessType: z.enum(['online_store', 'salon', 'gym', 'restaurant', 'travel', 'other']).nullable(),
    segmentId: z.enum(SEGMENT_IDS),
    segmentLabel: z.string().min(1).max(60),
    segmentRule: z.string().min(1).max(400),
    offerReason: z.string().min(1).max(600),
    discountPercent: z.number().int().min(0).max(90),
    windowDays: z.number().int().min(1).max(365),
    tone: z.enum(['friendly', 'professional', 'playful']),
  })
  .strict();
export type DraftRequestBody = z.infer<typeof DraftRequestSchema>;

export const EmailDraftSchema = z.object({
  subject: z.string().min(1).max(200),
  preheader: z.string().max(300),
  body: z.string().min(1).max(5000),
});
export type EmailDraftBody = z.infer<typeof EmailDraftSchema>;

/** A draft failure the route turns into an HTTP status + a message the UI can show. */
export class DraftError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const BUSINESS_LABELS: Record<NonNullable<DraftRequestBody['businessType']>, string> = {
  online_store: 'an online store',
  salon: 'a hair salon',
  gym: 'a gym or fitness studio',
  restaurant: 'a restaurant or café',
  travel: 'a travel agency',
  other: 'a small business',
};

const SYSTEM = `You write short marketing emails for small businesses. The owner will review and send them.

Rules:
- Address the reader with the merge field {{first_name}}. If there is a discount, refer to the code only as {{discount_code}}. Use no other merge fields.
- Don't invent facts: no product names, prices, dates, store hours or events that weren't given. Keep it general where you don't know specifics.
- State the discount exactly as given, and that it's valid for the given number of days. If there's no discount, don't mention or hint at one.
- Plain text, short paragraphs, under 150 words in the body. Sign off as "The team".
- Subject under 60 characters; preheader under 100 characters and different from the subject.`;

export function buildPrompt(r: DraftRequestBody): string {
  const offer = r.discountPercent > 0 ? `${r.discountPercent}% off, valid for ${r.windowDays} days` : 'No discount. A plain email.';
  return [
    `Business: ${r.businessType ? BUSINESS_LABELS[r.businessType] : 'a small business'}`,
    `Customer group: ${r.segmentLabel}. ${r.segmentRule}`,
    `Offer: ${offer}`,
    `Why this offer: ${r.offerReason}`,
    `Tone: ${r.tone}`,
    '',
    'Write the email for this group.',
  ].join('\n');
}

export type Drafter = (r: DraftRequestBody) => Promise<EmailDraftBody>;

export const GEMINI_MODEL = 'gemini-3.1-flash-lite';

/**
 * The shape Gemini must reply in (structured output). The body comes back as a list of paragraphs
 * because Flash-Lite sometimes drops line breaks inside a single string; we join them ourselves.
 * Gemini ignores string-length limits in the schema, so every reply is still validated in code.
 */
const GEMINI_REPLY_JSON_SCHEMA = {
  type: 'object',
  properties: {
    subject: { type: 'string', description: 'Email subject line, under 60 characters.' },
    preheader: { type: 'string', description: 'Inbox preview text, under 100 characters, different from the subject.' },
    paragraphs: {
      type: 'array',
      description: 'The email body, one item per paragraph: the greeting line first ("Hi {{first_name}},"), then 1 to 3 short paragraphs, then the sign-off.',
      items: { type: 'string' },
      minItems: 3,
      maxItems: 6,
    },
  },
  required: ['subject', 'preheader', 'paragraphs'],
  propertyOrdering: ['subject', 'preheader', 'paragraphs'],
};

const GeminiReplySchema = z.object({
  subject: z.string(),
  preheader: z.string(),
  paragraphs: z.array(z.string().trim().min(1)).min(2).max(8),
});

/** Gemini's reply → the endpoint's existing response format, validated. */
export function toEmailDraft(reply: unknown): EmailDraftBody | null {
  const r = GeminiReplySchema.safeParse(reply);
  if (!r.success) return null;
  const draft = EmailDraftSchema.safeParse({
    subject: r.data.subject.trim(),
    preheader: r.data.preheader.trim(),
    body: r.data.paragraphs.map((p) => p.trim()).join('\n\n'),
  });
  return draft.success ? draft.data : null;
}

/** Finish reasons that mean Gemini's safety filters stopped the reply. */
const BLOCKED: ReadonlySet<string> = new Set([
  FinishReason.SAFETY,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.BLOCKLIST,
  FinishReason.SPII,
]);

/** The real drafter: one structured-output call to Gemini. */
export function geminiDrafter(makeClient: () => GoogleGenAI = () => new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })): Drafter {
  let client: GoogleGenAI | null = null;
  return async (r) => {
    try {
      // Created on first use, so a missing key never stops the server from starting.
      client ??= makeClient();
      const response = await client.models.generateContent({
        model: GEMINI_MODEL,
        contents: buildPrompt(r),
        config: {
          systemInstruction: SYSTEM,
          responseMimeType: 'application/json',
          responseJsonSchema: GEMINI_REPLY_JSON_SCHEMA,
          // A short, simple writing task: keep thinking (and latency) low.
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          maxOutputTokens: 4096,
        },
      });
      const finish = response.candidates?.[0]?.finishReason;
      if (response.promptFeedback?.blockReason || (finish && BLOCKED.has(finish))) {
        throw new DraftError(502, 'The AI declined to write this one.');
      }
      if (finish === FinishReason.MAX_TOKENS) throw new DraftError(502, 'The AI’s reply was cut off.');
      let json: unknown;
      try {
        json = JSON.parse(response.text ?? '');
      } catch {
        throw new DraftError(502, 'The AI’s reply wasn’t in the right shape.');
      }
      const draft = toEmailDraft(json);
      if (!draft) throw new DraftError(502, 'The AI’s reply wasn’t in the right shape.');
      return draft;
    } catch (e) {
      if (e instanceof DraftError) throw e;
      if (e instanceof ApiError) {
        // Gemini reports a bad key as 400 (API_KEY_INVALID) or 401/403.
        if (e.status === 400 || e.status === 401 || e.status === 403) {
          throw new DraftError(503, 'The AI service rejected the request. Check GEMINI_API_KEY.');
        }
        if (e.status === 429) throw new DraftError(429, 'The free AI quota is used up for now. Try again in a minute.');
        throw new DraftError(502, `The AI service returned an error (${e.status}).`);
      }
      // fetch() rejects with a TypeError when the network or DNS fails.
      if (e instanceof TypeError) throw new DraftError(502, 'Couldn’t reach the AI service.');
      throw new DraftError(500, 'Something went wrong writing the draft.');
    }
  };
}

export function createApp(drafter: Drafter, aiConfigured: boolean) {
  const app = express();
  app.use(express.json({ limit: '16kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, ai: aiConfigured });
  });

  app.post('/api/draft-email', async (req, res) => {
    const parsed = DraftRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'That request didn’t look right.' });
      return;
    }
    // No key: say so clearly up front instead of letting the SDK fail.
    if (!aiConfigured) {
      res.status(503).json({ error: 'AI drafting isn’t set up (no GEMINI_API_KEY).' });
      return;
    }
    try {
      res.json(await drafter(parsed.data));
    } catch (e) {
      const err = e instanceof DraftError ? e : new DraftError(500, 'Something went wrong writing the draft.');
      if (err.status >= 500 && !(e instanceof DraftError)) console.error(e);
      res.status(err.status).json({ error: err.message });
    }
  });

  return app;
}
