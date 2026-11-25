import { nairobiToday } from './nairobi-date.js';

export const PERIOD_INTERVALS: Readonly<Record<string, string>> = Object.freeze(
  {
    '24h': '24 hours',
    '7d': '7 days',
    '21d': '21 days',
    '42d': '42 days',
  },
);

const PERIOD_SPAN_DAYS: Readonly<Record<string, number>> = Object.freeze({
  '24h': 1,
  '7d': 7,
  '21d': 21,
  '42d': 42,
});

// The calendar dates a preset period covers: today in Nairobi, back the
// period's length. Null for 'all' and 'custom', which have no preset span.
export function presetWindowDates(
  period: string,
  now: Date = new Date(),
): { from: string; to: string } | null {
  const span = PERIOD_SPAN_DAYS[period];
  if (span === undefined) return null;
  const to = nairobiToday(now);
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - span * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return { from, to };
}

export type SourceState = 'live' | 'pending' | 'na';

export interface Provenance {
  source: SourceState;
  label: string;
  degraded?: boolean;
}

export function num(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function nullableNum(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function dateString(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value.slice(0, 10);
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value).slice(0, 10);
  }
  return null;
}

export function stringValue(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  return null;
}

export function source(label: string): Provenance {
  return { source: 'live', label };
}

export function pending(label: string): Provenance {
  return { source: 'pending', label };
}
