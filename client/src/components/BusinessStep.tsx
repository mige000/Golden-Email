import { BUSINESS_PRESETS } from '../lib/presets';
import type { BusinessType, Settings } from '../lib/types';
import { Button, Card, CardTitle } from './ui';

interface Props {
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  onBack: () => void;
  onContinue: () => void;
}

export function BusinessStep({ settings, onSettings, onBack, onContinue }: Props) {
  const marginPct = Math.round(settings.margin * 100);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-light tracking-tight text-slate-900">Your business</h1>
        <p className="mt-1 text-slate-600">Two numbers we can’t get from your sales data.</p>
      </div>

      <Card>
        <CardTitle hint="After the cost of the product or service, how much of each sale do you keep? A discount comes out of this.">
          What % of each sale is profit?
        </CardTitle>
        <div className="flex items-center gap-4">
          <input
            type="range"
            min={5}
            max={90}
            value={marginPct}
            onChange={(e) => onSettings({ margin: Number(e.target.value) / 100 })}
            className="w-full max-w-md accent-emerald-600"
            aria-label="Profit margin"
          />
          <span className="w-14 text-lg font-semibold tabular-nums text-slate-900">{marginPct}%</span>
        </div>
        <p className="mt-2 text-sm text-slate-500">
          On a $100 sale you keep about ${marginPct}. A discount bigger than {marginPct}% loses money on every sale.
        </p>
      </Card>

      <Card>
        <CardTitle hint="We count a purchase as a result of your email if it happens within this many days. Every rate and dollar figure uses it.">
          How long after an email should we count a purchase?
        </CardTitle>
        <div className="flex items-center gap-4">
          <input
            type="range"
            min={7}
            max={90}
            value={settings.windowDays}
            onChange={(e) => onSettings({ windowDays: Number(e.target.value) })}
            className="w-full max-w-md accent-emerald-600"
            aria-label="Time window in days"
          />
          <span className="w-20 text-lg font-semibold tabular-nums text-slate-900">{settings.windowDays} days</span>
        </div>
      </Card>

      <Card>
        <CardTitle hint="Optional. Sets sensible defaults and helps the email drafts sound right.">What kind of business is it?</CardTitle>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(BUSINESS_PRESETS) as BusinessType[]).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={settings.businessType === t}
              onClick={() => onSettings({ businessType: t, windowDays: BUSINESS_PRESETS[t].windowDays })}
              className={`rounded-full border px-3 py-1.5 text-sm ${
                settings.businessType === t
                  ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                  : 'border-slate-300 text-slate-700 hover:border-emerald-500'
              }`}
            >
              {BUSINESS_PRESETS[t].label}
            </button>
          ))}
        </div>
      </Card>

      <div className="flex items-center justify-between border-t border-slate-200 pt-4">
        <Button variant="ghost" onClick={onBack}>
          ← Back
        </Button>
        <Button onClick={onContinue}>See this week’s plan</Button>
      </div>
    </div>
  );
}
