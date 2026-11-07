import type { AddressInfo } from 'node:net';
import { ApiError, type GoogleGenAI } from '@google/genai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPrompt, createApp, DraftError, GEMINI_MODEL, geminiDrafter, type DraftRequestBody, type Drafter } from './app';

const body: DraftRequestBody = {
  businessType: 'salon',
  segmentId: 'slipping',
  segmentLabel: 'Slipping away',
  segmentRule: 'Bought 2 or more times, but not in the last 70 days.',
  offerReason: 'Only 7% of them buy within 30 days on their own.',
  discountPercent: 10,
  windowDays: 30,
  tone: 'friendly',
};

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

/** Start the app on a free port bound to the same address the tests fetch from. */
async function listen(drafter: Drafter, aiConfigured: boolean) {
  const server = createApp(drafter, aiConfigured).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  close = () => new Promise<void>((r) => server.close(() => r()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function serve(drafter: Drafter) {
  const url = await listen(drafter, true);
  return (payload: unknown) =>
    fetch(`${url}/api/draft-email`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
}

describe('POST /api/draft-email', () => {
  it('returns the draft', async () => {
    const post = await serve(async () => ({ subject: 'We miss you', preheader: 'Come back', body: 'Hi {{first_name}}' }));
    const res = await post(body);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ subject: 'We miss you', preheader: 'Come back', body: 'Hi {{first_name}}' });
  });

  it('rejects anything that isn’t a segment-level request (e.g. customer data)', async () => {
    const post = await serve(async () => {
      throw new Error('should not be called');
    });
    expect((await post({ ...body, customers: [{ name: 'Ann', email: 'ann@x.com' }] })).status).toBe(400);
    expect((await post({ ...body, discountPercent: 150 })).status).toBe(400);
    expect((await post({ ...body, segmentId: 'everyone' })).status).toBe(400);
  });

  it('passes drafter errors through as status + message', async () => {
    const post = await serve(async () => {
      throw new DraftError(503, 'AI drafting isn’t set up');
    });
    const res = await post(body);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'AI drafting isn’t set up' });
  });
});

describe('without credentials', () => {
  it('answers 503 "not set up" without calling the drafter', async () => {
    const url = await listen(async () => {
      throw new Error('should not be called');
    }, false);
    const res = await fetch(`${url}/api/draft-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/isn’t set up/);
  });
});

describe('geminiDrafter', () => {
  const reply = { subject: 'We miss you', preheader: 'Come back soon', paragraphs: ['Hi {{first_name}},', 'It’s been a while.', 'The team'] };
  const draft = { subject: 'We miss you', preheader: 'Come back soon', body: 'Hi {{first_name}},\n\nIt’s been a while.\n\nThe team' };
  const ok = (text: string, finishReason = 'STOP') => ({ text, candidates: [{ finishReason }] });
  const fakeClient = (generateContent: (args: unknown) => Promise<unknown>) => () =>
    ({ models: { generateContent } }) as unknown as GoogleGenAI;

  it('returns the validated draft in the endpoint’s format, paragraphs joined by blank lines', async () => {
    const d = geminiDrafter(fakeClient(async () => ok(JSON.stringify(reply))));
    await expect(d(body)).resolves.toEqual(draft);
  });

  it('asks Gemini 3.1 Flash-Lite for JSON in the draft shape', async () => {
    const generateContent = vi.fn(async (_args: unknown) => ok(JSON.stringify(reply)));
    await geminiDrafter(fakeClient(generateContent))(body);
    const args = generateContent.mock.calls[0]![0] as { model: string; contents: string; config: Record<string, unknown> };
    expect(args.model).toBe(GEMINI_MODEL);
    expect(GEMINI_MODEL).toBe('gemini-3.1-flash-lite');
    expect(args.contents).toBe(buildPrompt(body));
    expect(args.config).toMatchObject({
      responseMimeType: 'application/json',
      responseJsonSchema: { required: ['subject', 'preheader', 'paragraphs'] },
    });
    expect(String(args.config.systemInstruction)).toContain('{{first_name}}');
  });

  it('turns safety blocks into "declined"', async () => {
    const blocked = geminiDrafter(fakeClient(async () => ok('', 'SAFETY')));
    await expect(blocked(body)).rejects.toMatchObject({ status: 502, message: 'The AI declined to write this one.' });
    const promptBlocked = geminiDrafter(fakeClient(async () => ({ text: undefined, promptFeedback: { blockReason: 'SAFETY' } })));
    await expect(promptBlocked(body)).rejects.toMatchObject({ status: 502, message: 'The AI declined to write this one.' });
  });

  it('reports a reply cut off at the token limit', async () => {
    const d = geminiDrafter(fakeClient(async () => ok('{"subject": "We mi', 'MAX_TOKENS')));
    await expect(d(body)).rejects.toMatchObject({ status: 502, message: 'The AI’s reply was cut off.' });
  });

  it('never returns output that fails validation', async () => {
    const bad = [
      'not json',
      JSON.stringify({ subject: '' }),
      JSON.stringify({ ...reply, paragraphs: [] }),
      JSON.stringify({ ...reply, subject: '   ' }),
      JSON.stringify({ ...reply, paragraphs: ['Hi', 'x'.repeat(6000)] }),
    ];
    for (const text of bad) {
      const d = geminiDrafter(fakeClient(async () => ok(text)));
      await expect(d(body)).rejects.toMatchObject({ status: 502, message: 'The AI’s reply wasn’t in the right shape.' });
    }
  });

  it('maps Gemini API errors (bad key, quota, server) to clear messages', async () => {
    const failWith = (status: number) => geminiDrafter(fakeClient(async () => {
      throw new ApiError({ message: `status ${status}`, status });
    }));
    for (const status of [400, 401, 403]) {
      await expect(failWith(status)(body)).rejects.toMatchObject({ status: 503, message: expect.stringContaining('GEMINI_API_KEY') });
    }
    await expect(failWith(429)(body)).rejects.toMatchObject({ status: 429 });
    await expect(failWith(500)(body)).rejects.toMatchObject({ status: 502 });
  });

  it('maps network failures', async () => {
    const d = geminiDrafter(fakeClient(async () => {
      throw new TypeError('fetch failed');
    }));
    await expect(d(body)).rejects.toMatchObject({ status: 502, message: 'Couldn’t reach the AI service.' });
  });

  it('doesn’t create the client (or need a key) until the first draft', () => {
    const makeClient = vi.fn();
    geminiDrafter(makeClient);
    expect(makeClient).not.toHaveBeenCalled();
    expect(() => geminiDrafter()).not.toThrow();
  });
});

describe('buildPrompt', () => {
  it('includes only segment-level facts and the exact offer', () => {
    const p = buildPrompt(body);
    expect(p).toContain('a hair salon');
    expect(p).toContain('10% off, valid for 30 days');
    expect(buildPrompt({ ...body, discountPercent: 0 })).toContain('No discount');
  });
});
