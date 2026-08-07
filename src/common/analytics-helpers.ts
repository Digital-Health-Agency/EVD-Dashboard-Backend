export const PERIOD_INTERVALS: Readonly<Record<string, string>> = Object.freeze({
  '24h': '24 hours',
  '7d': '7 days',
  '21d': '21 days',
  '42d': '42 days',
});

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
