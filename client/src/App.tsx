import { useCallback, useDeferredValue, useState } from 'react';
import { BusinessStep } from './components/BusinessStep';
import { ErrorBoundary } from './components/ErrorBoundary';
import { MappingStep } from './components/MappingStep';
import { PlanScreen } from './components/PlanScreen';
import { SegmentDetail } from './components/SegmentDetail';
import { UploadStep, type LoadedDataset } from './components/UploadStep';
import { guessMapping } from './lib/mapping';
import { BUSINESS_PRESETS } from './lib/presets';
import { defaultSettings } from './lib/settings';
import type { DateOrder, Mapping, SegmentId, Settings } from './lib/types';
import { useDerived } from './useDerived';

type Step = 'upload' | 'mapping' | 'business' | 'plan';
const STEPS: { id: Step; label: string }[] = [
  { id: 'upload', label: 'Upload' },
  { id: 'mapping', label: 'Check your data' },
  { id: 'business', label: 'Your business' },
  { id: 'plan', label: 'Email plan' },
];

/** Settings that only make sense for one file are reset when a new file loads. */
function settingsForNewFile(prev: Settings, d: LoadedDataset): Settings {
  return {
    ...prev,
    todayOverride: null,
    gapOverride: null,
    missingDaysOverride: null,
    lostDaysOverride: null,
    p0Overrides: {},
    businessType: d.businessType,
    windowDays: d.businessType ? BUSINESS_PRESETS[d.businessType].windowDays : prev.windowDays,
  };
}

export default function App() {
  const [step, setStep] = useState<Step>('upload');
  const [dataset, setDataset] = useState<LoadedDataset | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [dateOrder, setDateOrder] = useState<DateOrder | null>(null);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [openSegment, setOpenSegment] = useState<SegmentId | null>(null);
  // Sliders update `settings` immediately; the (heavier) plan recomputes from the deferred copy,
  // so dragging stays smooth on large files.
  const deferredSettings = useDeferredValue(settings);
  const derived = useDerived(dataset?.table ?? null, mapping, dateOrder, deferredSettings);

  const updateSettings = useCallback((patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })), []);

  const load = (d: LoadedDataset) => {
    setDataset(d);
    setMapping(guessMapping(d.table));
    setDateOrder(null);
    setSettings((s) => settingsForNewFile(s, d));
    setOpenSegment(null);
    setStep('mapping');
  };

  const reachable = (s: Step) => {
    if (s === 'upload') return true;
    if (s === 'mapping') return dataset !== null;
    return derived.plan !== null;
  };

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-[#34346a] bg-page">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-md bg-brand text-sm font-bold text-on-accent">G</span>
            <span className="text-lg font-semibold tracking-tight text-brand">Golden Email</span>
          </div>
          <nav aria-label="Steps">
            <ol className="flex flex-wrap items-center gap-1 text-sm">
              {STEPS.map((s, i) => {
                const current = s.id === step;
                const enabled = reachable(s.id);
                return (
                  <li key={s.id} className="flex items-center gap-1">
                    {i > 0 && <span className="text-header-sep">›</span>}
                    <button
                      type="button"
                      disabled={!enabled}
                      onClick={() => {
                        setStep(s.id);
                        setOpenSegment(null);
                      }}
                      aria-current={current ? 'step' : undefined}
                      className={`border-b-2 px-2 py-1.5 font-mono text-xs tracking-[0.15em] uppercase ${
                        current
                          ? 'border-brand text-header-ink'
                          : enabled
                            ? 'border-transparent text-header-ink-2 hover:text-header-ink'
                            : 'border-transparent text-header-ink-3'
                      }`}
                    >
                      {i + 1}. {s.label}
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <ErrorBoundary
          onReset={() => {
            setDataset(null);
            setMapping(null);
            setOpenSegment(null);
            setStep('upload');
          }}
        >
        {step === 'upload' && <UploadStep onLoad={load} />}
        {step === 'mapping' && dataset && mapping && (
          <MappingStep
            dataset={dataset}
            mapping={mapping}
            onMapping={setMapping}
            dateOrder={dateOrder}
            onDateOrder={setDateOrder}
            derived={derived}
            settings={settings}
            onSettings={updateSettings}
            onBack={() => setStep('upload')}
            onContinue={() => setStep('business')}
          />
        )}
        {step === 'business' && derived.plan && (
          <BusinessStep settings={settings} onSettings={updateSettings} onBack={() => setStep('mapping')} onContinue={() => setStep('plan')} />
        )}
        {step === 'plan' && derived.plan && !openSegment && (
          <PlanScreen
            derived={derived}
            settings={settings}
            onSettings={updateSettings}
            onOpenSegment={(id) => {
              setOpenSegment(id);
              window.scrollTo({ top: 0 });
            }}
            onEditData={() => setStep('mapping')}
            stale={settings !== deferredSettings}
          />
        )}
        {step === 'plan' && derived.plan && openSegment && (
          <SegmentDetail
            id={openSegment}
            derived={derived}
            settings={settings}
            onSettings={updateSettings}
            onBack={() => setOpenSegment(null)}
          />
        )}
        </ErrorBoundary>
      </main>
    </div>
  );
}
