import type { BusinessType } from './types';

export interface BusinessPreset {
  label: string;
  /** How often a typical customer comes back, in days. */
  gapDays: number;
  /** Default time window W. */
  windowDays: number;
}

/** Rough starting points for when the data can't measure the gap; always editable. */
export const BUSINESS_PRESETS: Record<BusinessType, BusinessPreset> = {
  online_store: { label: 'Online store', gapDays: 45, windowDays: 30 },
  salon: { label: 'Salon / barber', gapDays: 35, windowDays: 30 },
  gym: { label: 'Gym / studio', gapDays: 7, windowDays: 14 },
  restaurant: { label: 'Restaurant / café', gapDays: 21, windowDays: 30 },
  travel: { label: 'Travel agency', gapDays: 365, windowDays: 90 },
  other: { label: 'Something else', gapDays: 30, windowDays: 30 },
};
