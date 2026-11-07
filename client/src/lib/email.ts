import { BUSINESS_PRESETS } from './presets';
import type { BusinessType, SegmentId, Tone } from './types';

/**
 * What the AI (or a template) gets to write an email. Segment-level facts only: no customer names,
 * emails or purchase rows ever leave the browser. Personal details go in as merge fields.
 */
export interface DraftRequest {
  businessType: BusinessType | null;
  segmentId: SegmentId;
  segmentLabel: string;
  /** Who's in the group, in plain words. */
  segmentRule: string;
  /** Why this offer, in plain words. */
  offerReason: string;
  /** Discount as a whole percent; 0 = no discount. */
  discountPercent: number;
  windowDays: number;
  tone: Tone;
}

export interface EmailDraft {
  subject: string;
  preheader: string;
  body: string;
}

export interface DraftResult {
  draft: EmailDraft;
  source: 'ai' | 'template';
  /** Why we fell back to a template, when we did. */
  note?: string;
}

export const MERGE_FIELDS = ['{{first_name}}', '{{discount_code}}'] as const;

const businessNoun = (t: BusinessType | null) =>
  ({ online_store: 'shop', salon: 'salon', gym: 'studio', restaurant: 'restaurant', travel: 'travel team', other: 'team' })[t ?? 'other'];

// ---------- Templates (the non-AI fallback) ----------

const GREETING: Record<Tone, string> = {
  friendly: 'Hi {{first_name}},',
  professional: 'Dear {{first_name}},',
  playful: 'Hey {{first_name}}! 👋',
};
const SIGN_OFF: Record<Tone, (noun: string) => string> = {
  friendly: (n) => `Thanks for being part of our ${n}.\n\nWarmly,\nThe team`,
  professional: () => 'Kind regards,\nThe team',
  playful: () => 'See you soon (we hope!),\nThe team',
};

interface SegmentCopy {
  subject: Record<Tone, string>;
  preheader: string;
  opening: Record<Tone, string>;
}

const COPY: Record<SegmentId, SegmentCopy> = {
  vip: {
    subject: { friendly: 'A thank-you, just for you', professional: 'Early access for our most valued customers', playful: 'You’re kind of a big deal' },
    preheader: 'Something special for our best customers.',
    opening: {
      friendly: 'You’re one of the people who make our {noun} what it is, and we wanted to say thank you.',
      professional: 'As one of our most valued customers, we would like to thank you for your continued support.',
      playful: 'Confession: you’re one of our absolute favourite customers. Don’t tell the others.',
    },
  },
  regular: {
    subject: { friendly: 'Something new we think you’ll like', professional: 'What’s new this month', playful: 'Fresh picks, just in' },
    preheader: 'A few new things, picked with you in mind.',
    opening: {
      friendly: 'Since you’ve been coming back to us, we thought you’d like a first look at what’s new.',
      professional: 'We are pleased to share some new additions we think you will appreciate.',
      playful: 'You’ve got great taste (we’ve noticed). So here’s what just landed.',
    },
  },
  secondTimer: {
    subject: { friendly: 'Here’s what to try next', professional: 'Recommended for your next visit', playful: 'Round three?' },
    preheader: 'You’ve been back once. Here’s a great next step.',
    opening: {
      friendly: 'Thanks for coming back! Since you’ve been with us a couple of times now, here are a few things we think you’d enjoy next.',
      professional: 'Thank you for returning. Based on your visits so far, we have a few recommendations for next time.',
      playful: 'Two visits down. We’re not saying it’s a habit yet, but… here’s what to try next.',
    },
  },
  new: {
    subject: { friendly: 'Welcome! Here’s what to try next', professional: 'Welcome, and thank you for your first order', playful: 'So… was it love at first purchase?' },
    preheader: 'Thanks for your first visit. Here’s where to go from here.',
    opening: {
      friendly: 'Thanks so much for your first visit. We hope you loved it! Here are a few favourites other customers try next.',
      professional: 'Thank you for choosing us. We hope your first experience met your expectations.',
      playful: 'Welcome to the club! We hope your first visit was a good one. Here’s what people usually try next.',
    },
  },
  slipping: {
    subject: { friendly: 'We miss you!', professional: 'It’s been a while', playful: 'Did we say something?' },
    preheader: 'It’s been a while. Here’s a reason to come back.',
    opening: {
      friendly: 'It’s been a little while since we saw you, and we miss you!',
      professional: 'We noticed it has been some time since your last visit, and we would love to welcome you back.',
      playful: 'It’s been a while and, honestly, it’s not the same without you.',
    },
  },
  slippingVip: {
    subject: { friendly: 'We’ve missed you, and we saved something for you', professional: 'A personal note for one of our best customers', playful: 'Our favourite customer has gone quiet…' },
    preheader: 'You’re one of our best customers. We’d love to see you again.',
    opening: {
      friendly: 'You’ve been one of our very best customers, and we noticed it’s been a little while. We’d love to see you again.',
      professional: 'As one of our most valued customers, we noticed it has been some time since your last visit, and we wanted to reach out personally.',
      playful: 'You’re one of our all-time favourite customers, and it’s been way too quiet without you.',
    },
  },
  lostVip: {
    subject: { friendly: 'We’d love to welcome you back', professional: 'An invitation for one of our most valued customers', playful: 'Come back, we’ve kept your spot warm' },
    preheader: 'You were one of our best customers. Here’s a reason to return.',
    opening: {
      friendly: 'You used to be one of our very best customers, and we’ve genuinely missed you.',
      professional: 'You were among our most valued customers, and we would very much like to welcome you back.',
      playful: 'You were basically royalty around here. The throne is still yours.',
    },
  },
  lostRegular: {
    subject: { friendly: 'It’s been a while. Come back and see us', professional: 'We would love to welcome you back', playful: 'Remember all those good times?' },
    preheader: 'You used to visit often. We’d love to see you again.',
    opening: {
      friendly: 'You used to visit us often, and it’s been a long time. We’d love to see you again.',
      professional: 'You were a regular customer of ours, and we would welcome the chance to serve you again.',
      playful: 'You used to be a regular. We still remember your order (okay, almost).',
    },
  },
  lost: {
    subject: { friendly: 'One last hello', professional: 'Before we say goodbye', playful: 'Is this goodbye?' },
    preheader: 'We’d love to see you again.',
    opening: {
      friendly: 'It’s been a long time, and we wanted to reach out one more time.',
      professional: 'It has been some time since your last visit, and we wanted to reach out personally.',
      playful: 'We’ve been staring at the door waiting for you. Okay, not literally. But almost.',
    },
  },
  oneAndDone: {
    subject: { friendly: 'Come back and see us', professional: 'An invitation to return', playful: 'Remember us?' },
    preheader: 'There’s more to discover.',
    opening: {
      friendly: 'You visited us once a while back, and we’d love to show you what else we have.',
      professional: 'Thank you again for your earlier visit. We would welcome the chance to serve you again.',
      playful: 'We met once and we think it went pretty well. Fancy a second date?',
    },
  },
};

function offerLine(req: DraftRequest): string {
  if (req.discountPercent > 0) {
    return `As a thank-you, here’s ${req.discountPercent}% off your next order with the code {{discount_code}}. It’s valid for the next ${req.windowDays} days.`;
  }
  const lapsed: SegmentId[] = ['lost', 'lostVip', 'lostRegular', 'oneAndDone', 'slipping', 'slippingVip'];
  return lapsed.includes(req.segmentId)
    ? 'Whenever you’re ready, we’ll be here.'
    : 'We’d love to see you again soon.';
}

/** Hand-written fallback so drafting always works, with or without the AI. */
export function templateDraft(req: DraftRequest): EmailDraft {
  const copy = COPY[req.segmentId];
  const noun = businessNoun(req.businessType);
  const subject = req.discountPercent > 0 ? `${copy.subject[req.tone]}: ${req.discountPercent}% off inside` : copy.subject[req.tone];
  const body = [GREETING[req.tone], copy.opening[req.tone].replace('{noun}', noun), offerLine(req), SIGN_OFF[req.tone](noun)].join('\n\n');
  return { subject, preheader: copy.preheader, body };
}

// ---------- Calling the server ----------

/** Lightweight shape check: the server already validates, but never display unchecked JSON. */
export function isEmailDraft(x: unknown): x is EmailDraft {
  if (!x || typeof x !== 'object') return false;
  const d = x as Record<string, unknown>;
  return (
    typeof d.subject === 'string' && d.subject.trim().length > 0 && d.subject.length <= 200 &&
    typeof d.preheader === 'string' && d.preheader.length <= 300 &&
    typeof d.body === 'string' && d.body.trim().length > 0 && d.body.length <= 5000
  );
}

export function businessLabel(t: BusinessType | null): string {
  return t ? BUSINESS_PRESETS[t].label : 'Small business';
}

/** Ask the server for an AI draft; any failure falls back to the template, with a reason. */
export async function requestDraft(req: DraftRequest, signal?: AbortSignal): Promise<DraftResult> {
  const fallback = (note: string): DraftResult => ({ draft: templateDraft(req), source: 'template', note });
  try {
    const res = await fetch('/api/draft-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal,
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { error?: string } | null;
      return fallback(err?.error ?? (res.status === 404 ? 'The AI server isn’t running.' : 'The AI couldn’t write this one.'));
    }
    const data: unknown = await res.json();
    return isEmailDraft(data) ? { draft: data, source: 'ai' } : fallback('The AI’s reply wasn’t in the right shape.');
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    return fallback('The AI server isn’t running.');
  }
}
