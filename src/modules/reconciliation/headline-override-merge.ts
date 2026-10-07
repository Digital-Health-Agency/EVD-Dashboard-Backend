import {
  HEADLINE_FIGURE_FIELDS,
  type HeadlineFigureKey,
  type HeadlineFigures,
  type HeadlineOverrideRow,
} from './headline-override.schema.js';

type PublicSection = 'cases' | 'labs' | 'poe';

interface ScreeningTrendPoint {
  date: string | null;
  screened: number;
  alerts: number;
}

const SCREENING_TREND_POINTS = 14;

export interface PublicPayloadShape {
  meta: { lastUpdated: string | null };
  cases: Record<string, unknown>;
  labs: Record<string, unknown>;
  poe: Record<string, unknown> & {
    byPoe: ReadonlyArray<{ unknown: boolean }>;
    trend: ScreeningTrendPoint[];
  };
}

export type MergedPublicPayload<P extends PublicPayloadShape> = P & {
  poe: { screeningPoints: number };
};

export const PUBLIC_FIELD_MAP: ReadonlyArray<{
  key: HeadlineFigureKey;
  section: PublicSection;
  field: string;
}> = [
  { key: 'confirmed_cases', section: 'cases', field: 'confirmed' },
  { key: 'confirmed_cases_24h', section: 'cases', field: 'newConfirmed24h' },
  { key: 'recoveries', section: 'cases', field: 'recoveries' },
  { key: 'deaths', section: 'cases', field: 'deaths' },
  { key: 'contacts_listed', section: 'cases', field: 'contactsListed' },
  { key: 'samples_tested_total', section: 'labs', field: 'testsDone' },
  { key: 'samples_tested_24h', section: 'labs', field: 'newTested24h' },
  { key: 'positive_samples', section: 'labs', field: 'positive' },
  { key: 'negative_samples', section: 'labs', field: 'negative' },
  { key: 'travellers_screened_total', section: 'poe', field: 'totalScreened' },
  { key: 'travellers_screened_24h', section: 'poe', field: 'newScreened24h' },
  { key: 'screening_points', section: 'poe', field: 'screeningPoints' },
];

export function overrideValue<T>(
  entered: number | null | undefined,
  warehouse: T,
): number | T {
  return entered === null || entered === undefined ? warehouse : entered;
}

export function hasAnyFigure(
  row: HeadlineOverrideRow | null | undefined,
): boolean {
  if (!row) return false;
  return HEADLINE_FIGURE_FIELDS.some(
    (key) => row[key] !== null && row[key] !== undefined,
  );
}

export function warehouseHeadlineFigures(sections: {
  labs: Record<string, unknown>;
  cases: Record<string, unknown>;
  poe: Record<string, unknown>;
  poeRows: ReadonlyArray<{ unknown: boolean }>;
}): HeadlineFigures {
  const figures = {} as HeadlineFigures;
  for (const { key, section, field } of PUBLIC_FIELD_MAP) {
    const value = sections[section][field];
    figures[key] =
      typeof value === 'number' && Number.isFinite(value) ? value : null;
  }
  figures.screening_points = sections.poeRows.filter(
    (row) => !row.unknown,
  ).length;
  return figures;
}

export function mergeScreeningTrend(
  trend: ScreeningTrendPoint[],
  series: HeadlineOverrideRow[],
): ScreeningTrendPoint[] {
  const undated: ScreeningTrendPoint[] = [];
  const byDate = new Map<string, ScreeningTrendPoint>();
  for (const point of trend) {
    if (point.date === null) undated.push({ ...point });
    else byDate.set(point.date, { ...point });
  }

  for (const row of series) {
    const screened = row.travellers_screened_24h;
    if (screened === null || screened === undefined) continue;
    byDate.set(row.situation_date, {
      date: row.situation_date,
      screened,
      alerts: byDate.get(row.situation_date)?.alerts ?? 0,
    });
  }

  const dated = [...byDate.entries()]
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([, point]) => point);
  return [...undated, ...dated].slice(-SCREENING_TREND_POINTS);
}

/** Cumulative values carry forward; 24-hour values belong only to the latest date. */
export function resolveHeadlineRow(
  series: HeadlineOverrideRow[],
): HeadlineOverrideRow | null {
  const latest = series[0];
  if (!latest) return null;
  const resolved = { ...latest };
  for (const key of HEADLINE_FIGURE_FIELDS) {
    if (key.endsWith('_24h') || key === 'screening_points') continue;
    const previous = series.find(
      (row) => row[key] !== null && row[key] !== undefined,
    );
    resolved[key] = previous?.[key] ?? null;
  }
  return resolved;
}

export function applyHeadlineOverride<P extends PublicPayloadShape>(
  payload: P,
  series: HeadlineOverrideRow[],
): MergedPublicPayload<P> {
  const latest = resolveHeadlineRow(series);
  const sections: Record<PublicSection, Record<string, unknown>> = {
    cases: { ...payload.cases },
    labs: { ...payload.labs },
    poe: {
      ...payload.poe,
      screeningPoints: payload.poe.byPoe.filter((row) => !row.unknown).length,
      trend: mergeScreeningTrend(payload.poe.trend, series),
    },
  };

  for (const { key, section, field } of PUBLIC_FIELD_MAP) {
    const entered = latest?.[key];
    sections[section][field] = overrideValue(entered, sections[section][field]);
    if (entered !== null && entered !== undefined) {
      sections[section].available = true;
    }
  }

  const lastUpdated =
    latest && hasAnyFigure(latest)
      ? `${latest.situation_date}T00:00:00.000Z`
      : payload.meta.lastUpdated;

  return {
    ...payload,
    meta: { ...payload.meta, lastUpdated },
    ...sections,
  } as MergedPublicPayload<P>;
}
