import { describe, expect, it } from 'vitest';
import { HEADLINE_SEED_ROWS } from '../../scripts/seed-headline-overrides.js';

import {
  PUBLIC_FIELD_MAP,
  applyHeadlineOverride,
  hasAnyFigure,
  mergeScreeningTrend,
  overrideValue,
  warehouseHeadlineFigures,
} from './headline-override-merge.js';
import {
  HEADLINE_FIGURE_FIELDS,
  type HeadlineFigures,
  type HeadlineOverrideRow,
} from './headline-override.schema.js';

const WAREHOUSE_UPDATED = '2026-07-16T00:00:00.000Z';
const OFFICIAL_UPDATED = '2026-10-06T00:00:00.000Z';

it('uses the full seed series without carrying current screening capacity or 24-hour figures forward', () => {
  const series = HEADLINE_SEED_ROWS.map((seed) => row(seed.situation_date, seed)).reverse();
  const merged = applyHeadlineOverride(warehousePayload(), series);
  expect(merged.cases).toMatchObject({ confirmed: 1, deaths: 1, recoveries: 0, contactsListed: 28 });
  expect(merged.labs).toMatchObject({ testsDone: 267, newTested24h: 4 });
  expect(merged.poe).toMatchObject({ totalScreened: 652584, screeningPoints: 2, newScreened24h: 1116 });
  expect(merged.meta.lastUpdated).toBe(OFFICIAL_UPDATED);
});

function row(
  situationDate: string,
  figures: Partial<HeadlineFigures> = {},
): HeadlineOverrideRow {
  const blank = Object.fromEntries(
    HEADLINE_FIGURE_FIELDS.map((key) => [key, null]),
  ) as HeadlineFigures;
  return {
    situation_date: situationDate,
    report_date: null,
    source_label: null,
    notes: null,
    ...blank,
    ...figures,
    updatedBy: null,
  };
}

const OFFICIAL_ROW = row('2026-10-06', {
  confirmed_cases: 1,
  confirmed_cases_24h: 1,
  recoveries: 0,
  deaths: 1,
  samples_tested_total: 267,
  positive_samples: 1,
  negative_samples: 266,
  travellers_screened_total: 652584,
  contacts_listed: 28,
});

function warehouseTrend() {
  return [
    { date: '2026-07-14' as string | null, screened: 5, alerts: 1 },
    { date: '2026-07-15' as string | null, screened: 6, alerts: 0 },
  ];
}

function warehousePayload() {
  return {
    meta: {
      lastUpdated: WAREHOUSE_UPDATED as string | null,
      provenance: {
        cases: { source: 'live', label: 'Source: gold.report_case' },
        labs: { source: 'live', label: 'Source: gold.report_lab_result' },
        poe: { source: 'live', label: 'Source: gold.report_screening' },
      },
    },
    cases: {
      available: false,
      confirmed: 0,
      newConfirmed24h: 0,
      recoveries: 3,
      deaths: 0,
      contactsListed: 59,
    },
    labs: {
      available: true,
      testsDone: 163,
      newTested24h: 4,
      positive: 5,
      negative: 158,
    },
    poe: {
      available: true,
      totalScreened: 117687,
      newScreened24h: 1116,
      byPoe: [
        { name: 'Jomo Kenyatta International Airport', unknown: false },
        { name: 'Busia', unknown: false },
        { name: 'Not recorded', unknown: true },
      ],
      trend: warehouseTrend(),
    },
  };
}

const WAREHOUSE_HEADLINE: Record<string, number> = {
  'cases.confirmed': 0,
  'cases.newConfirmed24h': 0,
  'cases.recoveries': 3,
  'cases.deaths': 0,
  'cases.contactsListed': 59,
  'labs.testsDone': 163,
  'labs.newTested24h': 4,
  'labs.positive': 5,
  'labs.negative': 158,
  'poe.totalScreened': 117687,
  'poe.newScreened24h': 1116,
  'poe.screeningPoints': 2,
};

function headline(
  merged: Record<'cases' | 'labs' | 'poe', Record<string, unknown>>,
) {
  return Object.fromEntries(
    PUBLIC_FIELD_MAP.map(({ section, field }) => [
      `${section}.${field}`,
      merged[section][field],
    ]),
  );
}

function day(offset: number): string {
  return new Date(Date.UTC(2026, 8, 1 + offset)).toISOString().slice(0, 10);
}

function days(count: number, from = 0): string[] {
  return Array.from({ length: count }, (_, index) => day(from + index));
}

const overrideValueCases: Array<
  [number | null | undefined, number | null, number]
> = [
  [null, 7, 7],
  [undefined, 7, 7],
  [0, 7, 0],
  [1, 7, 1],
  [5, null, 5],
];

const hasAnyFigureCases = [
  {
    name: 'a row with every figure blank',
    row: row('2026-10-06'),
    expected: false,
  },
  {
    name: 'a row whose only figure is a zero',
    row: row('2026-10-06', { positive_samples: 0 }),
    expected: true,
  },
  { name: 'null', row: null, expected: false },
  { name: 'undefined', row: undefined, expected: false },
];

const headlineCases = [
  {
    name: 'leaves every figure and the date alone for an empty series',
    series: [],
    changed: {},
    lastUpdated: WAREHOUSE_UPDATED,
  },
  {
    name: 'takes the nine figures the 2026-10-06 row carries and its date',
    series: [OFFICIAL_ROW],
    changed: {
      'cases.confirmed': 1,
      'cases.newConfirmed24h': 1,
      'cases.recoveries': 0,
      'cases.deaths': 1,
      'cases.contactsListed': 28,
      'labs.testsDone': 267,
      'labs.positive': 1,
      'labs.negative': 266,
      'poe.totalScreened': 652584,
    },
    lastUpdated: OFFICIAL_UPDATED,
  },
  {
    name: 'uses neither the figures nor the date of a row with nothing entered',
    series: [row('2026-10-06')],
    changed: {},
    lastUpdated: WAREHOUSE_UPDATED,
  },
  {
    name: 'lets a stored zero win over a warehouse 5',
    series: [row('2026-10-06', { positive_samples: 0 })],
    changed: { 'labs.positive': 0 },
    lastUpdated: OFFICIAL_UPDATED,
  },
  {
    name: 'takes entered screening points over the derived count',
    series: [row('2026-10-06', { screening_points: 15 })],
    changed: { 'poe.screeningPoints': 15 },
    lastUpdated: OFFICIAL_UPDATED,
  },
  {
    name: 'carries missing cumulative values forward from older rows',
    series: [
      row('2026-10-06', { deaths: 1 }),
      row('2026-10-04', { deaths: 9, recoveries: 9 }),
    ],
    changed: { 'cases.deaths': 1, 'cases.recoveries': 9 },
    lastUpdated: OFFICIAL_UPDATED,
  },
];

const trendCases = [
  {
    name: 'replaces an entered date, inserts a new one and skips a blank',
    trend: warehouseTrend(),
    series: [
      row('2026-07-14', { travellers_screened_24h: 999 }),
      row('2026-07-20', { travellers_screened_24h: 42 }),
      row('2026-07-15', { travellers_screened_24h: null }),
    ],
    expected: [
      { date: '2026-07-14', screened: 999, alerts: 1 },
      { date: '2026-07-15', screened: 6, alerts: 0 },
      { date: '2026-07-20', screened: 42, alerts: 0 },
    ],
  },
  {
    name: 'returns the warehouse points for an empty series',
    trend: warehouseTrend(),
    series: [],
    expected: warehouseTrend(),
  },
  {
    name: 'lets a stored zero replace the warehouse count',
    trend: warehouseTrend(),
    series: [row('2026-07-15', { travellers_screened_24h: 0 })],
    expected: [
      { date: '2026-07-14', screened: 5, alerts: 1 },
      { date: '2026-07-15', screened: 0, alerts: 0 },
    ],
  },
  {
    name: 'ignores every figure but the 24-hour screening count',
    trend: warehouseTrend(),
    series: [row('2026-07-15', { travellers_screened_total: 652584 })],
    expected: warehouseTrend(),
  },
  {
    name: 'places an entered date older than the warehouse points first',
    trend: warehouseTrend(),
    series: [row('2026-07-01', { travellers_screened_24h: 7 })],
    expected: [
      { date: '2026-07-01', screened: 7, alerts: 0 },
      { date: '2026-07-14', screened: 5, alerts: 1 },
      { date: '2026-07-15', screened: 6, alerts: 0 },
    ],
  },
  {
    name: 'builds the series from entered rows alone when the warehouse has none',
    trend: [],
    series: [
      row('2026-10-06', { travellers_screened_24h: 30 }),
      row('2026-10-04', { travellers_screened_24h: 20 }),
    ],
    expected: [
      { date: '2026-10-04', screened: 20, alerts: 0 },
      { date: '2026-10-06', screened: 30, alerts: 0 },
    ],
  },
  {
    name: 'passes an undated warehouse point through ahead of the dated ones',
    trend: [{ date: null, screened: 3, alerts: 2 }, ...warehouseTrend()],
    series: [row('2026-07-14', { travellers_screened_24h: 999 })],
    expected: [
      { date: null, screened: 3, alerts: 2 },
      { date: '2026-07-14', screened: 999, alerts: 1 },
      { date: '2026-07-15', screened: 6, alerts: 0 },
    ],
  },
];

const capCases = [
  [14, 14, 0],
  [14, 14, 3],
  [14, 10, 10],
  [14, 0, 20],
  [5, 3, 2],
];

describe('overrideValue', () => {
  it.each(overrideValueCases)(
    'overrideValue(%s, %s) is %s',
    (entered, warehouse, expected) => {
      expect(overrideValue(entered, warehouse)).toBe(expected);
    },
  );
});

describe('hasAnyFigure', () => {
  it.each(hasAnyFigureCases)('is $expected for $name', (testCase) => {
    expect(hasAnyFigure(testCase.row)).toBe(testCase.expected);
  });
});

describe('PUBLIC_FIELD_MAP', () => {
  it('maps each of the twelve headline figures exactly once', () => {
    const keys = PUBLIC_FIELD_MAP.map((entry) => entry.key);

    expect(keys).toHaveLength(12);
    expect(new Set(keys)).toEqual(new Set(HEADLINE_FIGURE_FIELDS));
  });

  it('never points two figures at the same payload field', () => {
    const targets = PUBLIC_FIELD_MAP.map(
      ({ section, field }) => `${section}.${field}`,
    );

    expect(new Set(targets).size).toBe(targets.length);
  });
});

describe('warehouseHeadlineFigures', () => {
  it('returns all twelve figures', () => {
    const { cases, labs, poe } = warehousePayload();

    const figures = warehouseHeadlineFigures({
      cases,
      labs,
      poe,
      poeRows: poe.byPoe,
    });

    expect(Object.keys(figures).sort()).toEqual(
      [...HEADLINE_FIGURE_FIELDS].sort(),
    );
    expect(Object.values(figures)).not.toContain(null);
  });

  it.each([...PUBLIC_FIELD_MAP])(
    '$key entered back as its warehouse value leaves $field in $section unchanged',
    ({ section, field }) => {
      const payload = warehousePayload();
      const figures = warehouseHeadlineFigures({
        cases: payload.cases,
        labs: payload.labs,
        poe: payload.poe,
        poeRows: payload.poe.byPoe,
      });

      const unmerged = applyHeadlineOverride(payload, []);
      const merged = applyHeadlineOverride(payload, [
        row('2026-10-06', figures),
      ]);

      expect(headline(merged)[`${section}.${field}`]).toBe(
        headline(unmerged)[`${section}.${field}`],
      );
      expect(headline(merged)).toEqual(WAREHOUSE_HEADLINE);
    },
  );
});

describe('applyHeadlineOverride', () => {
  it.each(headlineCases)('$name', ({ series, changed, lastUpdated }) => {
    const merged = applyHeadlineOverride(warehousePayload(), series);

    expect(headline(merged)).toEqual({ ...WAREHOUSE_HEADLINE, ...changed });
    expect(merged.meta.lastUpdated).toBe(lastUpdated);
  });

  it('serves the screening trend merged from the whole series', () => {
    const payload = warehousePayload();
    const series = [
      OFFICIAL_ROW,
      row('2026-07-20', { travellers_screened_24h: 42 }),
      row('2026-07-14', { travellers_screened_24h: 999 }),
    ];

    const merged = applyHeadlineOverride(payload, series);

    expect(merged.poe.trend).toEqual([
      { date: '2026-07-14', screened: 999, alerts: 1 },
      { date: '2026-07-15', screened: 6, alerts: 0 },
      { date: '2026-07-20', screened: 42, alerts: 0 },
    ]);
    expect(merged.poe.trend).toEqual(
      mergeScreeningTrend(payload.poe.trend, series),
    );
  });

  it('never mutates the payload and adds no override marker', () => {
    const payload = warehousePayload();
    const before = structuredClone(payload);

    const merged = applyHeadlineOverride(payload, [
      OFFICIAL_ROW,
      row('2026-07-14', { travellers_screened_24h: 999 }),
    ]);

    expect(payload).toEqual(before);
    expect(merged.poe.trend).not.toBe(payload.poe.trend);
    expect(merged.meta.provenance).toEqual(before.meta.provenance);
    expect(JSON.stringify(merged)).not.toMatch(/override/i);
    expect(Object.keys(merged.poe.trend[0]).sort()).toEqual([
      'alerts',
      'date',
      'screened',
    ]);
  });
});

describe('mergeScreeningTrend', () => {
  it.each(trendCases)('$name', ({ trend, series, expected }) => {
    expect(mergeScreeningTrend(trend, series)).toEqual(expected);
  });

  it('drops the three oldest of 14 warehouse points for three later entered dates', () => {
    const warehouse = days(14).map((date) => ({
      date,
      screened: 100,
      alerts: 1,
    }));
    const series = days(3, 14).map((date) =>
      row(date, { travellers_screened_24h: 7 }),
    );

    const merged = mergeScreeningTrend(warehouse, series);

    expect(merged.map((point) => point.date)).toEqual(days(14, 3));
    expect(merged.slice(-3)).toEqual(
      days(3, 14).map((date) => ({ date, screened: 7, alerts: 0 })),
    );
  });

  it.each(capCases)(
    'returns %i ascending points for %i warehouse and %i entered dates',
    (expected, warehouse, entered) => {
      const trend = days(warehouse).map((date) => ({
        date,
        screened: 100,
        alerts: 0,
      }));
      const series = days(entered, warehouse)
        .reverse()
        .map((date) => row(date, { travellers_screened_24h: 7 }));

      const dates = mergeScreeningTrend(trend, series).map(
        (point) => point.date,
      );

      expect(dates).toHaveLength(expected);
      expect(dates.length).toBeLessThanOrEqual(14);
      expect(dates).toEqual([...dates].sort());
      expect(dates.at(-1)).toBe(day(warehouse + entered - 1));
    },
  );

  it('never mutates the trend or the points it was given', () => {
    const trend = warehouseTrend();
    const before = structuredClone(trend);

    const merged = mergeScreeningTrend(trend, [
      row('2026-07-14', { travellers_screened_24h: 999 }),
    ]);

    expect(trend).toEqual(before);
    expect(merged).not.toBe(trend);
    expect(merged[0]).not.toBe(trend[0]);
    expect(merged[1]).not.toBe(trend[1]);
  });
});

describe('partial headline records', () => {
  it('preserves official cumulative totals when a newer row has only a 24-hour figure', () => {
    const merged = applyHeadlineOverride(warehousePayload(), [
      row('2026-10-07', { samples_tested_24h: 8 }),
      OFFICIAL_ROW,
    ]);
    expect(merged.cases.confirmed).toBe(1);
    expect(merged.cases.deaths).toBe(1);
    expect(merged.cases.contactsListed).toBe(28);
    expect(merged.labs.testsDone).toBe(267);
    expect(merged.labs.newTested24h).toBe(8);
    expect(merged.cases.newConfirmed24h).toBe(0);
  });

  it('honours an explicit zero without carrying an older total over it', () => {
    const merged = applyHeadlineOverride(warehousePayload(), [
      row('2026-10-07', { confirmed_cases: 0 }),
      OFFICIAL_ROW,
    ]);
    expect(merged.cases.confirmed).toBe(0);
    expect(merged.cases.deaths).toBe(1);
  });
});
