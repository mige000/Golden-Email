import { useEffect, useMemo, useRef, useState } from 'react';
import { requestDraft, templateDraft, type DraftRequest, type DraftResult, type EmailDraft } from '../lib/email';
import { explainOffer, type PlanSegment } from '../lib/plan';
import { segmentRule, type ReasonContext } from '../lib/segments';
import { SEGMENT_LABELS, type Settings, type Tone } from '../lib/types';
import { Button, Card, CardTitle, Notice } from './ui';

interface Props {
  x: PlanSegment;
  ctx: ReasonContext;
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
}

const TONES: { id: Tone; label: string }[] = [
  { id: 'friendly', label: 'Friendly' },
  { id: 'professional', label: 'Professional' },
  { id: 'playful', label: 'Playful' },
];

/** Is the AI server up and configured? null while checking. */
function useAiAvailable(): boolean | null {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/api/health', { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { ai?: boolean } | null) => setOk(Boolean(d?.ai)))
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === 'AbortError')) setOk(false);
      });
    return () => ctrl.abort();
  }, []);
  return ok;
}

export function EmailDraftPanel({ x, ctx, settings, onSettings }: Props) {
  const request: DraftRequest = useMemo(
    () => ({
      businessType: settings.businessType,
      segmentId: x.id,
      segmentLabel: SEGMENT_LABELS[x.id],
      segmentRule: segmentRule(x.id, ctx),
      offerReason: explainOffer(x, settings.windowDays),
      discountPercent: x.rec.action === 'email-discount' ? Math.round(x.rec.discount * 100) : 0,
      windowDays: settings.windowDays,
      tone: settings.tone,
    }),
    [x, ctx, settings.businessType, settings.windowDays, settings.tone],
  );
  const requestKey = JSON.stringify(request);

  const aiAvailable = useAiAvailable();
  const [result, setResult] = useState<DraftResult>(() => ({ draft: templateDraft(request), source: 'template' }));
  /** The request the shown draft was written for. */
  const [writtenFor, setWrittenFor] = useState(requestKey);
  const [draft, setDraft] = useState<EmailDraft>(result.draft);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const inflight = useRef<AbortController | null>(null);

  // Templates follow the settings instantly; an AI draft stays until the user regenerates it.
  useEffect(() => {
    if (result.source === 'template' && writtenFor !== requestKey) {
      const t = templateDraft(request);
      setResult({ draft: t, source: 'template', note: result.note });
      setDraft(t);
      setWrittenFor(requestKey);
    }
  }, [requestKey, request, result.source, result.note, writtenFor]);

  useEffect(() => () => inflight.current?.abort(), []);

  const writeWithAi = async () => {
    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    setLoading(true);
    try {
      const r = await requestDraft(request, ctrl.signal);
      setResult(r);
      setDraft(r.draft);
      setWrittenFor(requestKey);
    } catch {
      /* aborted */
    } finally {
      if (inflight.current === ctrl) setLoading(false);
    }
  };

  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied('failed');
    }
  };

  const stale = result.source === 'ai' && writtenFor !== requestKey;
  const field = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600';

  return (
    <Card>
      <CardTitle hint="Written for this group and its offer. Edit anything before you copy it.">Draft the email</CardTitle>

      {x.rec.action === 'no-email' && (
        <div className="mb-3">
          <Notice tone="info">Under your current assumptions this group isn’t worth emailing, but here’s a draft if you want one.</Notice>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1" role="group" aria-label="Tone">
          {TONES.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={settings.tone === t.id}
              onClick={() => onSettings({ tone: t.id })}
              className={`rounded-md px-3 py-1.5 text-sm ${settings.tone === t.id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <Button onClick={() => void writeWithAi()} disabled={loading}>
          {loading ? 'Writing…' : result.source === 'ai' ? 'Write another' : 'Write with AI'}
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        {result.source === 'ai' ? (
          <span className="rounded-full bg-violet-50 px-2 py-0.5 font-medium text-violet-700 ring-1 ring-violet-600/20 ring-inset">
            Written by AI · read it before sending
          </span>
        ) : (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700">Template</span>
        )}
        {result.note && <span className="text-slate-500">{result.note} Showing a ready-made template instead.</span>}
        {!result.note && result.source === 'template' && aiAvailable === false && (
          <span className="text-slate-500">AI drafting isn’t set up, so this is a ready-made template.</span>
        )}
        {stale && <span className="text-amber-700">You changed the tone or offer. Write another to match.</span>}
      </div>

      <div className={`mt-4 space-y-3 ${loading ? 'opacity-60' : ''}`}>
        <label className="block">
          <span className="text-xs font-medium text-slate-500">Subject</span>
          <input className={`${field} mt-1`} value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-500">Preview text (shown after the subject in most inboxes)</span>
          <input className={`${field} mt-1`} value={draft.preheader} onChange={(e) => setDraft({ ...draft, preheader: e.target.value })} />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-500">Body</span>
          <textarea
            className={`${field} mt-1 min-h-56 font-[inherit] leading-relaxed`}
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          <code className="rounded bg-slate-100 px-1">{'{{first_name}}'}</code>
          {request.discountPercent > 0 && (
            <>
              {' '}and <code className="rounded bg-slate-100 px-1">{'{{discount_code}}'}</code>
            </>
          )}{' '}
          {request.discountPercent > 0 ? 'are' : 'is'} filled in by your email tool. No customer details are sent to the AI.
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => void copy('subject', draft.subject)}>
            {copied === 'subject' ? 'Copied ✓' : 'Copy subject'}
          </Button>
          <Button variant="secondary" onClick={() => void copy('body', draft.body)}>
            {copied === 'body' ? 'Copied ✓' : 'Copy body'}
          </Button>
        </div>
      </div>
      {copied === 'failed' && <p className="mt-2 text-xs text-rose-700">Couldn’t copy. Select the text and copy it yourself.</p>}
    </Card>
  );
}
