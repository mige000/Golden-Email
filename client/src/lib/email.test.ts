import { afterEach, describe, expect, it, vi } from 'vitest';
import { isEmailDraft, requestDraft, templateDraft, type DraftRequest } from './email';
import { SEGMENT_IDS, type Tone } from './types';

const req: DraftRequest = {
  businessType: 'online_store',
  segmentId: 'slipping',
  segmentLabel: 'Slipping away',
  segmentRule: 'Bought 2+ times, not lately.',
  offerReason: 'Only 7% buy anyway.',
  discountPercent: 10,
  windowDays: 30,
  tone: 'friendly',
};

describe('templateDraft', () => {
  it('writes a valid draft for every group and tone', () => {
    for (const segmentId of SEGMENT_IDS) {
      for (const tone of ['friendly', 'professional', 'playful'] as Tone[]) {
        const d = templateDraft({ ...req, segmentId, tone });
        expect(isEmailDraft(d), `${segmentId}/${tone}`).toBe(true);
        expect(d.body).toContain('{{first_name}}');
        expect(d.body).not.toContain('{noun}');
      }
    }
  });

  it('states the discount and its window, and never hints at one when there is none', () => {
    const d = templateDraft(req);
    expect(d.subject).toContain('10% off');
    expect(d.body).toContain('10% off your next order with the code {{discount_code}}');
    expect(d.body).toContain('30 days');
    const plain = templateDraft({ ...req, discountPercent: 0 });
    expect(`${plain.subject} ${plain.body}`).not.toMatch(/%|discount_code/);
  });
});

describe('requestDraft', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the AI draft when the server returns a valid one', async () => {
    const draft = { subject: 'S', preheader: 'P', body: 'B' };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(draft), { status: 200 })));
    await expect(requestDraft(req)).resolves.toEqual({ draft, source: 'ai' });
  });

  it('falls back to the template with the server’s reason', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'AI drafting isn’t set up' }), { status: 503 })));
    const r = await requestDraft(req);
    expect(r).toMatchObject({ source: 'template', note: 'AI drafting isn’t set up' });
    expect(r.draft).toEqual(templateDraft(req));
  });

  it('falls back when the server is down or replies with junk', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed');
    }));
    expect((await requestDraft(req)).note).toMatch(/isn’t running/);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ subject: '' }), { status: 200 })));
    expect((await requestDraft(req)).source).toBe('template');
  });
});
