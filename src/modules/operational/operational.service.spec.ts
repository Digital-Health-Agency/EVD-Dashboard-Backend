import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import type { QueryResultRow } from 'pg';

import type { Queryable } from '../../database/database.module.js';
import { pending, source } from '../../common/analytics-helpers.js';
import {
  buildBreakdown,
  buildCard,
  buildChart,
  earliest,
  inBoundedGroups,
  latest,
  OperationalService,
} from './operational.service.js';
import type { TabPayload } from './tab-payload.js';
import { operationalFiltersSchema } from './dto/operational-filters.dto.js';

const FRESH_INGEST = new Date(Date.now() - 2 * 3600 * 1000).toISOString();

const SERVICE_SOURCE_PATH = resolve(
  'src/modules/operational/operational.service.ts',
);

const STALE_INGEST = '2026-07-28T13:28:11Z';

function summaryRow(lastUpdated: string) {
  return {
    tests_done: 436,
    positive_tests: 21,
    negative_tests: 415,
    window_from: '2026-07-04',
    window_to: '2026-07-25',
    last_updated: lastUpdated,
  };
}

const BUCKET_ROW = {
  positive: 21,
  negative: 415,
};

const BREAKDOWN_ROWS = [
  {
    name: 'National Public Health Laboratory',
    filter_value: 'National Public Health Laboratory',
    tests: 400,
    positive: 20,
    negative: 380,
    total_groups: 4,
  },
  {
    name: 'KEMRI Nairobi',
    filter_value: 'KEMRI Nairobi',
    tests: 36,
    positive: 1,
    negative: 35,
    total_groups: 4,
  },
  {
    name: 'Not recorded',
    filter_value: null,
    tests: 12,
    positive: 0,
    negative: 12,
    total_groups: 4,
  },
];

function fakeDb(
  queries: string[],
  values: unknown[][],
  lastUpdated: string,
): Queryable {
  return {
    query<T extends QueryResultRow>(sql: string, params?: unknown[]) {
      queries.push(sql);
      values.push(params ?? []);

      let rows: unknown[];
      if (sql.includes('AS tests_done')) {
        rows = [summaryRow(lastUpdated)];
      } else if (sql.includes('grouped AS')) {
        rows = BREAKDOWN_ROWS;
      } else {
        throw new Error(`Unexpected SQL: ${sql}`);
      }

      return Promise.resolve({
        rows: rows as T[],
        rowCount: rows.length,
      });
    },
  };
}

function parse(input: Record<string, unknown>) {
  return operationalFiltersSchema.parse(input);
}

async function runLabsTab(
  input: Record<string, unknown> = {},
  lastUpdated: string = FRESH_INGEST,
) {
  const queries: string[] = [];
  const values: unknown[][] = [];
  const service = new OperationalService(fakeDb(queries, values, lastUpdated));
  const payload = await service.labsTab(parse(input));
  return { payload, queries, values };
}

describe('OperationalService.labsTab', () => {
  it('returns exactly the three D-31 laboratory cards, counted in test events', async () => {
    const { payload } = await runLabsTab();

    expect(payload.cards).toHaveLength(3);
    expect(payload.cards.map((card) => card.key)).toEqual([
      'testsDone',
      'positiveTests',
      'negativeTests',
    ]);

    for (const card of payload.cards) {
      expect(card.label.toLowerCase()).toContain('tests');
      expect(`${card.key} ${card.label}`.toLowerCase()).not.toMatch(
        /turnaround|tat|pending/,
      );
    }

    expect(payload.cards.map((card) => card.value)).toEqual([436, 21, 415]);
    expect(payload.meta.tab).toBe('labs');
  });

  it('renders measured numbers over an unrefreshed warehouse', async () => {
    const { payload } = await runLabsTab({}, STALE_INGEST);

    expect(payload.cards.map((card) => card.value)).toEqual([436, 21, 415]);
    for (const card of payload.cards) {
      expect(card.meta?.dataQualityStatus).not.toBe('stale');
      expect(card.detail).not.toBeNull();
    }
    expect(payload.cards[0].meta?.lastUpdated).toBe(STALE_INGEST);
  });

  it('charts by testing laboratory, off the same rows as the breakdown', async () => {
    const { payload } = await runLabsTab();
    const chart = payload.charts[0];

    expect(payload.charts).toHaveLength(1);
    expect(chart.key).toBe('byLaboratory');
    expect(chart.series.map((series) => series.key)).toEqual([
      'positive',
      'negative',
    ]);
    expect(chart.data).toBe(payload.breakdown?.rows);
    expect(chart.data.map((row) => row.name)).toEqual([
      'National Public Health Laboratory',
      'KEMRI Nairobi',
      'Not recorded',
    ]);
  });

  it('derives negative tests as tests done minus positive, on cards and per laboratory', async () => {
    const { payload, queries } = await runLabsTab();
    const [testsDone, positive, negative] = payload.cards;

    expect(negative.value).toBe(
      (testsDone.value as number) - (positive.value as number),
    );
    expect(negative.detail).toBe('All test events not recorded positive');
    expect(queries.join('\n')).toContain(
      '(coalesce(sum(total_test_count), 0) - coalesce(sum(positive_test_count), 0))::int',
    );
    expect(queries.join('\n')).not.toContain('sum(negative_test_count)');

    for (const row of payload.breakdown?.rows ?? []) {
      expect(row.negative).toBe(
        (row.tests as number) - (row.positive as number),
      );
    }
  });

  it('offers the same one-key drill-down on the chart and the breakdown', async () => {
    const { payload, queries } = await runLabsTab();
    const expected = {
      dataset: 'labResults',
      filterKey: 'lab',
      listLabel: 'Tests',
      noun: 'lab results',
    };

    expect(payload.charts[0].linelist).toEqual(expected);
    expect(payload.breakdown?.linelist).toEqual(expected);

    expect(
      payload.breakdown?.rows.map((row) => row.filterValue),
    ).toEqual(['National Public Health Laboratory', 'KEMRI Nairobi', null]);
    expect(payload.breakdown?.rows[2].name).toBe('Not recorded');

    const sql = queries.find((text) => text.includes('grouped AS')) ?? '';
    expect(sql).toContain(
      'count(DISTINCT nullif(testing_laboratory_name, \'\')) = 1',
    );
    expect(sql).toContain('GROUP BY 1\n');
  });

  it('names the tab data source from the indicator register', async () => {
    const { payload } = await runLabsTab();

    expect(payload.meta.sources).toEqual(['LIMS']);
  });

  it('anchors a preset period to max(event_at) as a SQL interval', async () => {
    const { payload, queries, values } = await runLabsTab({ period: '42d' });

    expect(queries.join('\n')).toContain(
      "bounds.max_event_at - interval '42 days'",
    );
    expect(queries.join('\n')).not.toContain('now()');
    expect(payload.meta.window.anchored).toBe(true);
    expect(payload.meta.window.period).toBe('42d');
    expect(values[0]).toEqual(['86518-8']);
  });

  it('applies no window at all for the all-time period', async () => {
    const { payload, queries, values } = await runLabsTab({ period: 'all' });
    const sql = queries.join('\n');

    expect(sql).toContain('event_at IS NOT NULL');
    expect(sql).not.toContain('interval');
    expect(sql).not.toContain('undefined');
    expect(sql).not.toContain('now()');

    expect(payload.meta.window.anchored).toBe(false);
    expect(payload.meta.window.period).toBe('all');

    expect(values[0]).toEqual(['86518-8']);
  });

  it('applies a custom range as two bound timestamps rather than an anchored interval', async () => {
    const { payload, queries, values } = await runLabsTab({
      period: 'custom',
      from: '2026-07-01',
      to: '2026-07-25',
    });

    expect(queries.join('\n')).toContain('event_at >= $2::timestamptz');
    expect(queries.join('\n')).toContain('event_at <= $3::timestamptz');
    expect(queries.join('\n')).not.toContain('interval');
    expect(values[0]).toEqual([
      '86518-8',
      '2026-07-01 00:00:00',
      '2026-07-25 23:59:59.999',
    ]);
    expect(payload.meta.window.anchored).toBe(false);
  });

  it('binds each D-32 predicate as a placeholder when supplied and emits none when absent', async () => {
    const absent = await runLabsTab();
    for (const column of [
      'result_category =',
      'specimen_type =',
      'test_name =',
      'turnaround_time_band =',
    ]) {
      expect(absent.queries.join('\n')).not.toContain(column);
    }

    const supplied = await runLabsTab({
      resultStatus: 'POSITIVE',
      specimenType: 'BLOOD',
      testName: 'Ebola PCR',
      turnaroundBand: '1 DAY',
    });
    const sql = supplied.queries.join('\n');

    expect(sql).toContain('result_category = $2');
    expect(sql).toContain('specimen_type = $3');
    expect(sql).toContain('test_name = $4');
    expect(sql).toContain('turnaround_time_band = $5');
    expect(supplied.values[0]).toEqual([
      '86518-8',
      'POSITIVE',
      'BLOOD',
      'Ebola PCR',
      '1 DAY',
    ]);
  });

  it('narrows on the laboratory the option list was built from, as a bound value', async () => {
    const absent = await runLabsTab();
    expect(absent.queries.join('\n')).not.toContain('testing_laboratory_name)) =');

    const { queries, values, payload } = await runLabsTab({
      lab: 'National Virology Reference Laboratory (NVRL)',
    });
    const sql = queries.join('\n');

    expect(sql).toContain(
      'lower(btrim(testing_laboratory_name)) = lower(btrim($2))',
    );
    expect(sql).not.toContain('National Virology Reference Laboratory');
    expect(values[0]).toEqual([
      '86518-8',
      'National Virology Reference Laboratory (NVRL)',
    ]);
    expect(payload.meta.filters.lab).toBe(
      'National Virology Reference Laboratory (NVRL)',
    );
  });

  it('applies the laboratory filter to the cards, the chart and the breakdown alike', async () => {
    const { queries } = await runLabsTab({ lab: 'NVRL Mobile Laboratory 1' });

    expect(queries).toHaveLength(2);
    for (const sql of queries) {
      expect(sql).toContain(
        'lower(btrim(testing_laboratory_name)) = lower(btrim($2))',
      );
    }
  });

  it('offers no geography predicate on the laboratory tab', async () => {
    const { queries } = await runLabsTab({
      lab: 'NVRL Mobile Laboratory 2',
    });
    const sql = queries.join('\n');

    expect(sql).not.toContain('reporting_county');
    expect(sql).not.toContain('reporting_subcounty');
    expect(sql).not.toContain('health_facility');
    expect(sql).not.toMatch(/dim_facilitylist/);
  });

  it('reads gold only — no bronze, silver or marts object is named', async () => {
    const { queries } = await runLabsTab();
    const sql = queries.join('\n');

    expect(sql).toContain('gold.');
    expect(sql).toContain('gold.report_lab_result');
    expect(sql).not.toMatch(/\b(bronze|silver)\./);
    expect(sql).not.toMatch(/\bmarts\./);
  });

  it('never projects a direct identifier column', async () => {
    const { queries } = await runLabsTab();
    const sql = queries.join('\n');

    expect(sql).not.toContain('subject_identifier');
    expect(sql).not.toContain('specimen_identifier');
    expect(sql).not.toContain('case_identifier');
    expect(sql).not.toMatch(/SELECT\s+\*/);
  });

  it('carries the breakdown truncation counts and a machine-only provenance label', async () => {
    const { payload } = await runLabsTab();

    expect(payload.breakdown?.total).toBe(4);
    expect(payload.breakdown?.shown).toBe(3);
    expect(payload.meta.provenance.cards.label).toContain(
      'gold.report_lab_result',
    );
    expect(payload.meta.provenance.cards.source).toBe('live');
  });
});

const POE_SUMMARY_ROW = {
  travellers_screened: 125919,
  secondary_alerts: 812,
  suspected_at_poe: 75,
  window_from: '2026-06-16',
  window_to: '2026-07-28',
  last_updated: FRESH_INGEST,
};

const POE_CHART_ROWS = [
  { name: 'Jomo Kenyatta International Airport', alerts: 500 },
  { name: 'Busia One Stop Border Post', alerts: 312 },
];

const POE_BREAKDOWN_ROWS = [
  {
    name: 'Jomo Kenyatta International Airport',
    filter_value: 'Jomo Kenyatta International Airport',
    screened: 90000,
    total_groups: 31,
  },
  {
    name: 'Busia One Stop Border Post',
    filter_value: 'Busia One Stop Border Post',
    screened: 35919,
    total_groups: 31,
  },
];


function fakePoeDb(
  queries: string[],
  values: unknown[][],
  lastUpdated: string,
): Queryable {
  return {
    query<T extends QueryResultRow>(sql: string, params?: unknown[]) {
      queries.push(sql);
      values.push(params ?? []);

      let rows: unknown[];
      if (sql.includes('AS travellers_screened')) {
        rows = [{ ...POE_SUMMARY_ROW, last_updated: lastUpdated }];
      } else if (sql.includes('alerts_by_poe AS')) {
        rows = POE_CHART_ROWS;
      } else if (sql.includes('grouped_poe AS')) {
        rows = POE_BREAKDOWN_ROWS;
      } else {
        throw new Error(`Unexpected SQL: ${sql}`);
      }

      return Promise.resolve({ rows: rows as T[], rowCount: rows.length });
    },
  };
}

async function runPoeTab(
  input: Record<string, unknown> = {},
  lastUpdated: string = FRESH_INGEST,
) {
  const queries: string[] = [];
  const values: unknown[][] = [];
  const service = new OperationalService(
    fakePoeDb(queries, values, lastUpdated),
  );
  const payload = await service.poeTab(parse(input));
  return { payload, queries, values };
}

describe('OperationalService.poeTab', () => {
  it('carries the screening workload as the tab\'s only card', async () => {
    const { payload, queries } = await runPoeTab();

    expect(payload.meta.tab).toBe('poe');
    expect(payload.cards.map((card) => card.key)).toEqual([
      'travellersScreened',
    ]);
    expect(payload.cards.map((card) => card.value)).toEqual([125919]);

    expect(payload.breakdown?.columns.map((column) => column.key)).toEqual([
      'name',
      'screened',
    ]);
    expect(payload.charts[0].series.map((series) => series.key)).toEqual([
      'screened',
    ]);
    const sql = queries.join('\n');
    expect(sql).not.toContain('flagged_screening_count');
    expect(sql).not.toContain('suspected_screening_count');
  });

  it('carries no contact indicator anywhere on the tab', async () => {
    const { payload } = await runPoeTab();

    expect(
      payload.cards.some((card) => /contact/i.test(`${card.key} ${card.label}`)),
    ).toBe(false);
    expect(
      payload.breakdown?.columns.some((column) =>
        /contact/i.test(`${column.key} ${column.label}`),
      ),
    ).toBe(false);
    expect(
      payload.breakdown?.columns.every((column) => column.pending === false),
    ).toBe(true);
  });

  it('charts screenings by point of entry, off the breakdown rows', async () => {
    const { payload } = await runPoeTab();
    const chart = payload.charts[0];

    expect(payload.charts).toHaveLength(1);
    expect(chart.key).toBe('byPointOfEntry');
    expect(chart.series.map((series) => series.key)).toEqual(['screened']);
    expect(chart.data).toBe(payload.breakdown?.rows);
  });

  it('offers the same one-key drill-down on the chart and the breakdown', async () => {
    const { payload, queries } = await runPoeTab();
    const expected = {
      dataset: 'screenings',
      filterKey: 'poe',
      listLabel: 'Screenings',
      noun: 'screenings',
    };

    expect(payload.charts[0].linelist).toEqual(expected);
    expect(payload.breakdown?.linelist).toEqual(expected);

    const sql = queries.find((text) => text.includes('grouped_poe AS')) ?? '';
    expect(sql).toContain(
      "count(DISTINCT nullif(reporting_point_of_entry, '')) = 1",
    );
  });

  it('narrows on the point-of-entry column the option list was built from', async () => {
    const absent = await runPoeTab();
    expect(absent.queries.join('\n')).not.toContain(
      'reporting_point_of_entry)) =',
    );

    const { queries, values, payload } = await runPoeTab({
      poe: 'Busia One Stop Border Post',
    });
    const sql = queries.join('\n');

    expect(sql).toContain(
      'lower(btrim(reporting_point_of_entry)) = lower(btrim($2))',
    );
    expect(sql).not.toContain('Busia One Stop Border Post');
    expect(values[0]).toEqual(['TRAVELLER', 'Busia One Stop Border Post']);
    expect(payload.meta.filters.poe).toBe('Busia One Stop Border Post');
  });

  it('binds the two D-32 screening predicates when supplied and emits none when absent', async () => {
    const absent = await runPoeTab();
    for (const column of [
      'lower(btrim(screening_outcome))',
      'lower(btrim(reporting_screening_category))',
    ]) {
      expect(absent.queries.join('\n')).not.toContain(column);
    }

    const supplied = await runPoeTab({
      screeningOutcome: 'FLAGGED',
      screeningCategory: 'SUSPECTED',
    });
    const sql = supplied.queries.join('\n');

    expect(sql).toContain('lower(btrim(screening_outcome)) = lower(btrim($2))');
    expect(sql).toContain(
      'lower(btrim(reporting_screening_category)) = lower(btrim($3))',
    );
    expect(supplied.values[0]).toEqual(['TRAVELLER', 'FLAGGED', 'SUSPECTED']);
  });

  it('writes no source-system predicate — a single-valued column is a no-op control', async () => {
    const { queries } = await runPoeTab({ poe: 'Namanga One Stop Border Post' });
    const sql = queries.join('\n');

    expect(sql).not.toContain('source_system');
  });

  it('offers no geography predicate on the points-of-entry tab', async () => {
    const { queries } = await runPoeTab();
    const sql = queries.join('\n');

    expect(sql).not.toContain('reporting_county');
    expect(sql).not.toContain('reporting_subcounty');
    expect(sql).not.toContain('health_facility');
  });

  it('reads gold only, from its own table with its own anchor', async () => {
    const { queries, payload } = await runPoeTab({ period: '7d' });
    const sql = queries.join('\n');

    expect(sql).toContain('gold.report_screening');
    expect(sql).toContain('screening_datetime');
    expect(sql).toContain("bounds.max_event_at - interval '7 days'");
    expect(sql).not.toContain('now()');
    expect(sql).not.toMatch(/\b(bronze|silver)\./);
    expect(sql).not.toMatch(/\bmarts\./);
    expect(sql).not.toMatch(/SELECT\s+\*/);
    expect(payload.meta.window.anchored).toBe(true);
  });

  it('applies a custom range as an absolute window on this tab too', async () => {
    const { payload, queries, values } = await runPoeTab({
      period: 'custom',
      from: '2026-07-01',
      to: '2026-07-25',
    });

    expect(queries.join('\n')).toContain('event_at >= $2::timestamptz');
    expect(queries.join('\n')).toContain('event_at <= $3::timestamptz');
    expect(queries.join('\n')).not.toContain('interval');
    expect(values[0]).toEqual([
      'TRAVELLER',
      '2026-07-01 00:00:00',
      '2026-07-25 23:59:59.999',
    ]);
    expect(payload.meta.window.anchored).toBe(false);
  });

  it('reads the traveller pathway only, before the window is anchored', async () => {
    const { queries, values } = await runPoeTab();

    for (const sql of queries) {
      expect(sql).toContain('WHERE surveillance_pathway = $1');
      expect(sql.indexOf('surveillance_pathway = $1')).toBeLessThan(
        sql.indexOf('bounds AS'),
      );
      expect(sql).not.toContain("'TRAVELLER'");
      expect(sql).not.toContain('FACILITY');
    }
    expect(values[0]).toEqual(['TRAVELLER']);
  });

  it('carries the real group count alongside the capped row count', async () => {
    const { payload } = await runPoeTab();

    expect(payload.breakdown?.total).toBe(31);
    expect(payload.breakdown?.shown).toBe(2);
    expect(payload.charts[0].key).toBe('byPointOfEntry');
    expect(payload.charts[0].data.map((row) => row.screened)).toEqual([
      90000, 35919,
    ]);
  });

  it('renders measured numbers over an unrefreshed warehouse', async () => {
    const { payload } = await runPoeTab({}, STALE_INGEST);

    for (const card of payload.cards) {
      expect(card.meta?.dataQualityStatus).not.toBe('stale');
      expect(card.value).not.toBeNull();
    }
  });
});

const HF_SUMMARY_ROW = {
  total: 16,
  alerts: 0,
  window_from: '2026-08-01',
  window_to: '2026-08-04',
  last_updated: FRESH_INGEST,
};

const HF_BREAKDOWN_ROWS = [
  {
    name: 'Suba Sub County Hospital',
    filter_value: 'Suba Sub County Hospital',
    screened: 9,
    alerts: 0,
    confirmed: 0,
    current_admitted: 0,
    recovered: 0,
    deaths: 0,
    total_groups: 12,
  },
  {
    name: 'St Pius Musoli Health Centre',
    filter_value: 'St Pius Musoli Health Centre',
    screened: 7,
    alerts: 0,
    confirmed: 0,
    current_admitted: 0,
    recovered: 0,
    deaths: 0,
    total_groups: 12,
  },
];

function fakeHfDb(
  queries: string[],
  values: unknown[][],
  summaryOverride: Record<string, unknown> = {},
): Queryable {
  return {
    query<T extends QueryResultRow>(sql: string, params?: unknown[]) {
      queries.push(sql);
      values.push(params ?? []);

      let rows: unknown[];
      if (sql.includes('AS total,') && sql.includes('AS alerts')) {
        rows = [{ ...HF_SUMMARY_ROW, ...summaryOverride }];
      } else if (sql.includes('facility_groups AS')) {
        rows = HF_BREAKDOWN_ROWS;
      } else {
        throw new Error(`Unexpected SQL: ${sql}`);
      }

      return Promise.resolve({ rows: rows as T[], rowCount: rows.length });
    },
  };
}

async function runHfTab(
  input: Record<string, unknown> = {},
  summaryOverride: Record<string, unknown> = {},
) {
  const queries: string[] = [];
  const values: unknown[][] = [];
  const service = new OperationalService(
    fakeHfDb(queries, values, summaryOverride),
  );
  const payload = await service.hfTab(parse(input));
  return { payload, queries, values };
}

function nonFiniteValues(payload: unknown): unknown[] {
  const found: unknown[] = [];
  const walk = (node: unknown) => {
    if (typeof node === 'number') {
      if (!Number.isFinite(node)) found.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === 'object') {
      Object.values(node).forEach(walk);
    }
  };
  walk(payload);
  return found;
}

describe('OperationalService.hfTab', () => {
  it('returns the six owner-approved cards from the facility screening scope', async () => {
    const { payload } = await runHfTab();

    expect(payload.meta.tab).toBe('hf');
    expect(payload.cards.map((card) => [card.key, card.label, card.value])).toEqual([
      ['screened', 'Screened', 16],
      ['alerts', 'Alerts', 0],
      ['confirmed', 'Confirmed', 0],
      ['currentAdmitted', 'Current admitted', 0],
      ['recovered', 'Recovered', 0],
      ['deaths', 'Deaths', 0],
    ]);
    expect(payload.cards.every((card) => card.provenance.source === 'live')).toBe(
      true,
    );
  });

  it('keeps confirmed, current admitted, recovered and deaths as numeric zeroes with concise detail', async () => {
    const { payload } = await runHfTab({}, { total: 0, alerts: 0 });

    for (const key of ['confirmed', 'currentAdmitted', 'recovered', 'deaths']) {
      const card = payload.cards.find((candidate) => candidate.key === key);
      expect(card?.value).toBe(0);
      expect(card?.detail).toBeTruthy();
      expect(card?.detail).not.toMatch(/not captured|not available|no data/i);
      expect(card?.detail).not.toContain('Fixed at zero');
      expect(card?.meta?.dataQualityStatus).not.toBe('unavailable');
    }
    expect(nonFiniteValues(payload)).toEqual([]);
  });

  it('reads only TaifaCare rows from gold.report_screening', async () => {
    const { queries, values } = await runHfTab();
    const sql = queries.join('\n');

    expect(sql).toContain('FROM gold.report_screening');
    expect(sql).not.toContain('gold.report_case_investigation');
    expect(sql).not.toContain('gold.report_treatment_outcome');
    expect(sql).not.toMatch(/\b(bronze|silver|marts)\./);
    expect(sql).toContain('WHERE source_system = $1');
    for (const params of values) {
      expect(params[0]).toBe('TAIFACARE_KENYAEMR');
    }
  });

  it('applies the source scope before calculating the period anchor', async () => {
    const { queries, payload } = await runHfTab({ period: '21d' });

    for (const sql of queries) {
      expect(sql.indexOf('WHERE source_system = $1')).toBeLessThan(
        sql.indexOf('bounds AS'),
      );
      expect(sql).toContain("bounds.max_event_at - interval '21 days'");
      expect(sql).not.toContain('now()');
    }
    expect(payload.meta.window.anchored).toBe(true);
  });

  it('binds a custom range after the source-system parameter', async () => {
    const { queries, values, payload } = await runHfTab({
      period: 'custom',
      from: '2026-08-01',
      to: '2026-08-04',
    });

    for (const sql of queries) {
      expect(sql).toContain('event_at >= $2::timestamptz');
      expect(sql).toContain('event_at <= $3::timestamptz');
      expect(sql).not.toContain('interval');
    }
    expect(values[0]).toEqual([
      'TAIFACARE_KENYAEMR',
      '2026-08-01 00:00:00',
      '2026-08-04 23:59:59.999',
    ]);
    expect(payload.meta.window.anchored).toBe(false);
  });

  it('binds the facility filter and never interpolates its value', async () => {
    const facility = "St Mary's Health Centre";
    const { queries, values, payload } = await runHfTab({ facility });

    for (const sql of queries) {
      expect(sql).toContain('reporting_facility_name');
      expect(sql).toContain('facility_name');
      expect(sql).toContain('lower(btrim($2))');
      expect(sql).not.toContain(facility);
    }
    expect(values[0]).toEqual(['TAIFACARE_KENYAEMR', facility]);
    expect(payload.meta.filters.facility).toBe(facility);
  });

  it('projects every column consumed by the grouped statement', async () => {
    const { queries } = await runHfTab();
    const sql = queries.find((query) => query.includes('facility_groups AS')) ?? '';
    const projection = sql.slice(sql.indexOf('WITH base AS ('), sql.indexOf('bounds AS'));

    for (const column of [
      'reporting_facility_name',
      'facility_name',
      'flagged_screening_count',
      'total_screening_count',
      'ingested_at',
      'screening_datetime',
      'reporting_date',
    ]) {
      expect(projection).toContain(column);
    }
  });

  it('groups the chart and detail table by facility from the same rows', async () => {
    const { payload } = await runHfTab();

    expect(payload.breakdown?.total).toBe(12);
    expect(payload.breakdown?.shown).toBe(2);
    expect(payload.breakdown?.columns.map((column) => column.key)).toEqual([
      'name',
      'screened',
      'alerts',
      'confirmed',
      'currentAdmitted',
      'recovered',
      'deaths',
    ]);
    expect(payload.breakdown?.rows[0]).toMatchObject({
      name: 'Suba Sub County Hospital',
      filterValue: 'Suba Sub County Hospital',
      screened: 9,
      alerts: 0,
      confirmed: 0,
      currentAdmitted: 0,
      recovered: 0,
      deaths: 0,
    });
    expect(payload.charts[0].key).toBe('byFacility');
    expect(payload.charts[0].title).toBe(
      'Screenings, alerts and confirmed by facility',
    );
    expect(payload.charts[0].series.map((series) => series.key)).toEqual([
      'screened',
      'alerts',
      'confirmed',
    ]);
    expect(payload.charts[0].data).toBe(payload.breakdown?.rows);
  });

  it('does not expose a facility screening drill-down through the traveller linelist', async () => {
    const { payload } = await runHfTab();

    expect(payload.charts[0].linelist).toBeUndefined();
    expect(payload.breakdown?.linelist).toBeUndefined();
  });

  it('never projects a direct identifier column', async () => {
    const { queries } = await runHfTab();
    const sql = queries.join('\n');

    for (const column of [
      'person_name',
      'person_identifier',
      'source_person_name',
      'source_person_identifier',
    ]) {
      expect(sql).not.toContain(column);
    }
  });
});

const CONTACT_SUMMARY_ROW = {
  contacts_listed: 60,
  window_from: '2026-06-12',
  window_to: '2026-07-23',
  last_updated: FRESH_INGEST,
};

const CONTACT_GROUP_ROWS = [
  { name: 'Nairobi', listed: 49, total_groups: 3 },
  { name: 'Mombasa', listed: 8, total_groups: 3 },
  { name: 'Busia', listed: 3, total_groups: 3 },
];

function fakeContactDb(
  queries: string[],
  values: unknown[][],
  summaryOverride: Record<string, unknown> = {},
): Queryable {
  return {
    query<T extends QueryResultRow>(sql: string, params?: unknown[]) {
      queries.push(sql);
      values.push(params ?? []);

      let rows: unknown[];
      if (sql.includes('AS contacts_listed')) {
        rows = [{ ...CONTACT_SUMMARY_ROW, ...summaryOverride }];
      } else if (sql.includes('grouped_county AS')) {
        rows = CONTACT_GROUP_ROWS;
      } else {
        throw new Error(`Unexpected SQL: ${sql}`);
      }

      return Promise.resolve({ rows: rows as T[], rowCount: rows.length });
    },
  };
}

async function runContactsTab(
  input: Record<string, unknown> = {},
  summaryOverride: Record<string, unknown> = {},
) {
  const queries: string[] = [];
  const values: unknown[][] = [];
  const service = new OperationalService(
    fakeContactDb(queries, values, summaryOverride),
  );
  const payload = await service.contactsTab(parse(input));
  return { payload, queries, values };
}

describe('OperationalService.contactsTab', () => {
  it('reports the contact registrations the table actually holds', async () => {
    const { payload } = await runContactsTab();

    expect(payload.meta.tab).toBe('contacts');
    expect(payload.cards[0].key).toBe('contactsListed');
    expect(payload.cards[0].value).toBe(60);
  });

  it('carries no follow-up card or column at all', async () => {
    const { payload } = await runContactsTab();

    expect(payload.cards.map((card) => card.key)).toEqual(['contactsListed']);
    expect(payload.cards.some((card) => card.provenance.source === 'pending')).toBe(
      false,
    );

    expect(payload.breakdown?.columns.map((column) => column.key)).toEqual([
      'name',
      'listed',
    ]);
    expect(
      payload.breakdown?.columns.every((column) => column.pending === false),
    ).toBe(true);
    for (const key of ['followed', 'missed', 'symptomatic', 'twentyOneDay']) {
      expect(payload.breakdown?.rows[0]).not.toHaveProperty(key);
    }
  });

  it('groups listed contacts by county, never by classification', async () => {
    const { payload, queries } = await runContactsTab();

    expect(payload.breakdown?.title).toBe('Contacts listed by county');
    expect(payload.breakdown?.columns[0].label).toBe('County');
    expect(payload.breakdown?.rows.map((row) => row.name)).toEqual([
      'Nairobi',
      'Mombasa',
      'Busia',
    ]);

    const sql = queries.join('\n');
    expect(sql).toContain("coalesce(nullif(btrim(reporting_county), ''), 'Not recorded')");
    expect(sql).not.toContain('grouped_classification');

    const grouped = queries.find((text) => text.includes('grouped_county AS')) ?? '';
    const projection = grouped.slice(
      grouped.indexOf('WITH base AS ('),
      grouped.indexOf('bounds AS ('),
    );
    expect(projection).toContain('reporting_county');
  });

  it('emits no source-system predicate — the D-29 place-or-source gap is recorded, not built', async () => {
    const { payload, queries } = await runContactsTab({
      classification: 'SUSPECTED',
    });
    const sql = queries.join('\n');

    expect(sql).not.toContain('source_system');
    expect(Object.keys(payload.meta.filters)).toEqual([
      'period',
      'from',
      'to',
      'classification',
    ]);
    expect(payload.cards[0].meta?.allowedFilters).toEqual([
      'period',
      'classification',
    ]);
  });

  it('narrows on the classification column the option list was built from', async () => {
    const absent = await runContactsTab();
    expect(absent.queries.join('\n')).not.toContain(
      'lower(btrim(final_classification))',
    );

    const { queries, values } = await runContactsTab({
      classification: 'SUSPECTED',
    });
    const sql = queries.join('\n');

    expect(sql).toContain(
      'lower(btrim(final_classification)) = lower(btrim($1))',
    );
    expect(sql).not.toContain("'SUSPECTED'");
    expect(values[0]).toEqual(['SUSPECTED']);
  });

  it('anchors on the registration columns of a table that has no reporting date', async () => {
    const { queries, payload } = await runContactsTab({ period: '42d' });
    const sql = queries.join('\n');

    expect(sql).toContain('gold.report_contact_registration');
    expect(sql).toContain('registration_datetime');
    expect(sql).toContain('registration_date::timestamptz');
    expect(sql).not.toContain('reporting_date');
    expect(sql).toContain("bounds.max_event_at - interval '42 days'");
    expect(sql).not.toContain('now()');
    expect(payload.meta.window.anchored).toBe(true);
  });

  it('reads gold only and projects no direct identifier', async () => {
    const { queries } = await runContactsTab();
    const sql = queries.join('\n');

    expect(sql).not.toMatch(/\b(bronze|silver)\./);
    expect(sql).not.toMatch(/\bmarts\./);
    expect(sql).not.toMatch(/SELECT\s+\*/);
    for (const column of [
      'source_contact_name',
      'source_contact_identifier',
      'specimen_identifier',
    ]) {
      expect(sql).not.toContain(column);
    }
  });

  it('offers no geography predicate on the contacts tab', async () => {
    const { queries } = await runContactsTab();
    const sql = queries.join('\n');

    expect(sql).not.toMatch(/lower\(btrim\(reporting_county\)\) = /);
    expect(sql).not.toContain('reporting_subcounty');
    expect(sql).not.toContain('health_facility');
  });

  it('feeds the chart and the breakdown from one grouped snapshot', async () => {
    const { payload, queries } = await runContactsTab();

    expect(queries).toHaveLength(2);
    expect(payload.charts[0].key).toBe('byCounty');
    expect(payload.charts[0].data).toEqual([
      { name: 'Nairobi', listed: 49 },
      { name: 'Mombasa', listed: 8 },
      { name: 'Busia', listed: 3 },
    ]);
    expect(payload.breakdown?.total).toBe(3);
    expect(payload.breakdown?.shown).toBe(3);
  });
});

const COMMUNITY_SUMMARY_ROW = {
  signals_reported: 298,
  signals_verified: 203,
  verified_share: 68.1,
  window_from: '2026-06-15',
  window_to: '2026-07-27',
  last_updated: FRESH_INGEST,
};

const COMMUNITY_GROUP_ROWS = [
  { name: 'Busia County', reported: 180, verified: 120, total_groups: 14 },
  { name: 'Bungoma County', reported: 118, verified: 83, total_groups: 14 },
];

function fakeCommunityDb(
  queries: string[],
  values: unknown[][],
  summaryOverride: Record<string, unknown> = {},
): Queryable {
  return {
    query<T extends QueryResultRow>(sql: string, params?: unknown[]) {
      queries.push(sql);
      values.push(params ?? []);

      let rows: unknown[];
      if (sql.includes('AS signals_reported')) {
        rows = [{ ...COMMUNITY_SUMMARY_ROW, ...summaryOverride }];
      } else if (sql.includes('grouped_county AS')) {
        rows = COMMUNITY_GROUP_ROWS;
      } else {
        throw new Error(`Unexpected SQL: ${sql}`);
      }

      return Promise.resolve({ rows: rows as T[], rowCount: rows.length });
    },
  };
}

async function runCommunityTab(
  input: Record<string, unknown> = {},
  summaryOverride: Record<string, unknown> = {},
) {
  const queries: string[] = [];
  const values: unknown[][] = [];
  const service = new OperationalService(
    fakeCommunityDb(queries, values, summaryOverride),
  );
  const payload = await service.communityTab(parse(input));
  return { payload, queries, values };
}

describe('OperationalService.communityTab', () => {
  it('returns exactly the two measures D-33 keeps', async () => {
    const { payload } = await runCommunityTab();

    expect(payload.meta.tab).toBe('community');
    expect(payload.cards).toHaveLength(2);
    expect(payload.cards.map((card) => card.key)).toEqual([
      'signalsReported',
      'signalsVerified',
    ]);
    expect(payload.cards[0].label).toBe('Signals reported');
    expect(payload.cards[0].value).toBe(298);
    expect(payload.cards[1].label).toBe('Signals verified');
    expect(payload.cards[1].value).toBe(203);
    expect(payload.cards[1].unit).toBe('count');
    expect(payload.cards.every((card) => card.emphasis === 'plain')).toBe(true);
  });

  it('carries the share beneath the count as secondary text', async () => {
    const { payload } = await runCommunityTab();

    expect(payload.cards[1].detail).toBe('68.1% of 298 reported');
  });

  it('deletes the traced-contact and unlinked-signal measures rather than dashing them', async () => {
    const { payload } = await runCommunityTab();

    const labels = [
      ...payload.cards.flatMap((card) => [card.key, card.label]),
      ...(payload.breakdown?.columns.flatMap((column) => [
        column.key,
        column.label,
      ]) ?? []),
      ...payload.charts.flatMap((chart) => [
        chart.key,
        chart.title,
        ...chart.series.map((series) => series.label),
      ]),
    ];

    for (const label of labels) {
      expect(label).not.toMatch(/traced?\b|unlinked|linked|contact/i);
    }

    expect(
      payload.cards.every((card) => card.provenance.source === 'live'),
    ).toBe(true);
  });

  it('carries a three-column breakdown with no pending column', async () => {
    const { payload } = await runCommunityTab();

    expect(payload.breakdown?.columns).toHaveLength(3);
    expect(payload.breakdown?.columns.map((column) => column.key)).toEqual([
      'name',
      'reported',
      'verified',
    ]);
    expect(
      payload.breakdown?.columns.every((column) => column.pending === false),
    ).toBe(true);
    expect(payload.breakdown?.total).toBe(14);
    expect(payload.breakdown?.shown).toBe(2);
  });

  it('feeds the chart and the breakdown from one grouped snapshot', async () => {
    const { payload, queries } = await runCommunityTab();

    expect(queries).toHaveLength(2);
    expect(payload.charts[0].key).toBe('byCounty');
    expect(payload.charts[0].title).toBe('Verified signals by county');
    expect(payload.charts[0].data).toEqual([
      { name: 'Busia County', verified: 120 },
      { name: 'Bungoma County', verified: 83 },
    ]);
  });

  it('binds community source as the tab\'s only value placeholder', async () => {
    const absent = await runCommunityTab();
    expect(absent.queries.join('\n')).not.toContain(
      'lower(btrim(source_system))',
    );

    const supplied = await runCommunityTab({
      signalStatus: 'VERIFIED',
      signalType: 'Sudden Death',
      communitySource: 'MDHARURA',
    });
    const sql = supplied.queries.join('\n');

    expect(sql).toContain('lower(btrim(source_system)) = lower(btrim($1))');
    expect(sql).not.toContain('signal_status');
    expect(sql).not.toContain('signal_type');
    expect(sql).not.toContain("'MDHARURA'");
    expect(supplied.values[0]).toEqual(['MDHARURA']);
  });

  it('writes the community-source predicate whether or not its control renders', async () => {
    const { queries } = await runCommunityTab({ communitySource: 'ECHIS' });

    for (const sql of queries) {
      expect(sql).toContain('lower(btrim(source_system)) = lower(btrim($1))');
    }
  });

  it('renders a measured zero and omits the share when no signal is in scope', async () => {
    const { payload } = await runCommunityTab(
      {},
      { signals_reported: 0, signals_verified: 0, verified_share: null },
    );
    const verified = payload.cards[1];

    expect(verified.value).toBe(0);
    expect(verified.provenance.source).toBe('live');
    expect(verified.detail).toBe('No signal reported in the selected period');
    expect(verified.detail).not.toMatch(/%/);
    expect(nonFiniteValues(payload)).toEqual([]);
    expect(payload.cards[0].value).toBe(0);
  });

  it('never lets a NaN or an Infinity reach the payload', async () => {
    for (const poisoned of [Number.NaN, Number.POSITIVE_INFINITY, 'NaN']) {
      const { payload } = await runCommunityTab({}, { verified_share: poisoned });

      expect(payload.cards[1].value).toBe(203);
      expect(payload.cards[1].detail).not.toMatch(/NaN|Infinity|%/);
      expect(payload.cards[1].detail).toBe('of 298 signals reported');
    }
  });

  it("anchors a preset to this mart's own event columns and applies a custom range absolutely", async () => {
    const preset = await runCommunityTab({ period: '7d' });
    const presetSql = preset.queries.join('\n');

    expect(presetSql).toContain('gold.report_community_signals');
    expect(presetSql).toContain("bounds.max_event_at - interval '7 days'");
    expect(presetSql).not.toContain('now()');
    expect(preset.payload.meta.window.anchored).toBe(true);

    const custom = await runCommunityTab({
      period: 'custom',
      from: '2026-07-01',
      to: '2026-07-25',
    });
    expect(custom.queries.join('\n')).toContain('event_at >= $1::timestamptz');
    expect(custom.queries.join('\n')).toContain('event_at <= $2::timestamptz');
    expect(custom.queries.join('\n')).not.toContain('interval');
    expect(custom.values[0]).toEqual([
      '2026-07-01 00:00:00',
      '2026-07-25 23:59:59.999',
    ]);
    expect(custom.payload.meta.window.anchored).toBe(false);
  });

  it('groups by county without offering a geography predicate', async () => {
    const { queries } = await runCommunityTab();
    const sql = queries.join('\n');

    expect(sql).not.toContain('investigated_signal_count');
    expect(sql).toContain("coalesce(nullif(btrim(county), ''), 'Not recorded')");
    expect(sql).not.toMatch(/lower\(btrim\(county\)\) = /);
    expect(sql).not.toContain('subcounty');
    expect(sql).not.toContain('community_unit');
  });

  it('reads gold only and projects no potentially-identifying column', async () => {
    const { queries } = await runCommunityTab();
    const sql = queries.join('\n');

    expect(sql).toContain('gold.report_community_signals');
    expect(sql).not.toMatch(/\b(bronze|silver)\./);
    expect(sql).not.toMatch(/\bmarts\./);
    expect(sql).not.toMatch(/SELECT\s+\*/);
    for (const column of ['chp_area', 'signal_description']) {
      expect(sql).not.toContain(column);
    }
  });

  it('renders measured numbers over an unrefreshed warehouse', async () => {
    const { payload } = await runCommunityTab({}, { last_updated: STALE_INGEST });

    for (const card of payload.cards) {
      expect(card.meta?.dataQualityStatus).not.toBe('stale');
      expect(card.value).not.toBeNull();
    }
  });

  it('states a coverage that is not national on every community indicator', async () => {
    const { payload } = await runCommunityTab();

    for (const card of payload.cards) {
      expect(card.meta?.coverage).toBeDefined();
      expect(card.meta?.coverage).not.toMatch(/national/i);
    }
    expect(payload.cards[0].meta?.allowedFilters).toEqual([
      'period',
      'communitySource',
    ]);
    expect(payload.cards[0].meta?.securityClassification).toBe(
      'restricted aggregate',
    );
  });
});

const SUMMARY_CASE_ROW = {
  suspected: 72,
  probable: 3,
  alerts: 75,
  confirmed_cases: 0,
  cases_for_review: 75,
  samples_collected: 41,
  window_from: '2026-05-29',
  window_to: '2026-07-10',
  last_updated: FRESH_INGEST,
};

const SUMMARY_OUTCOME_ROW = {
  on_treatment: 0,
  recovered: 0,
  deaths: 0,
  window_from: '2026-06-02',
  window_to: '2026-07-10',
  last_updated: FRESH_INGEST,
};

const SUMMARY_SCREENING_ROW = {
  travellers_screened: 125919,
  window_from: '2026-06-16',
  window_to: '2026-07-28',
  last_updated: FRESH_INGEST,
};

const SUMMARY_COMMUNITY_ROW = {
  signals_reported: 298,
  signals_verified: 203,
  verified_share: 40,
  window_from: '2026-06-15',
  window_to: '2026-07-27',
  last_updated: FRESH_INGEST,
};

const SUMMARY_LAB_ROW = {
  ...BUCKET_ROW,
  window_from: '2026-07-04',
  window_to: '2026-07-25',
  last_updated: FRESH_INGEST,
};

const SUMMARY_CONTACT_ROW = {
  window_from: '2026-06-12',
  window_to: '2026-07-23',
  last_updated: FRESH_INGEST,
};

const SUMMARY_FLOW_ROWS = [
  { day: '2026-07-25', signals: 120, verified: 48, samples: 9 },
  { day: '2026-07-26', signals: 0, verified: 0, samples: 0 },
  { day: '2026-07-27', signals: 95, verified: 40, samples: 0 },
];

const SUMMARY_FACILITY_ROWS = [
  {
    name: 'Kenyatta National Hospital',
    alerts: 44,
    confirmed: 0,
    recovered: 0,
    deaths: 0,
    total_groups: 3,
  },
  {
    name: 'Mbagathi Hospital',
    alerts: 19,
    confirmed: 0,
    recovered: 0,
    deaths: 0,
    total_groups: 3,
  },
  {
    name: 'Not recorded',
    alerts: 12,
    confirmed: 0,
    recovered: 0,
    deaths: 0,
    total_groups: 3,
  },
];

interface SummaryProbe {
  queries: string[];
  values: unknown[][];
  maxInFlight: number;
}

function fakeSummaryDb(
  probe: SummaryProbe,
  overrides: Record<string, Record<string, unknown>> = {},
  facilityRows: Record<string, unknown>[] = SUMMARY_FACILITY_ROWS,
): Queryable {
  let inFlight = 0;

  return {
    async query<T extends QueryResultRow>(sql: string, params?: unknown[]) {
      probe.queries.push(sql);
      probe.values.push(params ?? []);

      let rows: unknown[];
      if (sql.includes('active_facilities AS')) {
        rows = facilityRows;
      } else if (sql.includes('AS alerts')) {
        rows = [{ ...SUMMARY_CASE_ROW, ...overrides.cases }];
      } else if (sql.includes('AS on_treatment')) {
        rows = [{ ...SUMMARY_OUTCOME_ROW, ...overrides.outcomes }];
      } else if (sql.includes('AS travellers_screened')) {
        rows = [{ ...SUMMARY_SCREENING_ROW, ...overrides.screening }];
      } else if (sql.includes('AS signals_reported')) {
        rows = [{ ...SUMMARY_COMMUNITY_ROW, ...overrides.community }];
      } else if (sql.includes('gold.report_contact_registration')) {
        rows = [{ ...SUMMARY_CONTACT_ROW, ...overrides.contacts }];
      } else if (sql.includes('community_daily AS')) {
        rows = SUMMARY_FLOW_ROWS;
      } else if (sql.includes('gold.report_lab_result')) {
        rows = [{ ...SUMMARY_LAB_ROW, ...overrides.laboratory }];
      } else {
        throw new Error(`Unexpected SQL: ${sql}`);
      }

      inFlight += 1;
      probe.maxInFlight = Math.max(probe.maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 0));
      inFlight -= 1;

      return { rows: rows as T[], rowCount: rows.length };
    },
  };
}

async function runSummaryTab(
  input: Record<string, unknown> = {},
  overrides: Record<string, Record<string, unknown>> = {},
  facilityRows: Record<string, unknown>[] = SUMMARY_FACILITY_ROWS,
) {
  const probe: SummaryProbe = { queries: [], values: [], maxInFlight: 0 };
  const service = new OperationalService(
    fakeSummaryDb(probe, overrides, facilityRows),
  );
  const payload = await service.summaryTab(parse(input));
  return { payload, ...probe };
}

describe('OperationalService.summaryTab', () => {
  it('carries exactly the five Section 7 cards, in order, all important', async () => {
    const { payload } = await runSummaryTab();

    expect(payload.meta.tab).toBe('summary');
    expect(payload.cards.map((card) => card.key)).toEqual([
      'alerts',
      'confirmedCases',
      'currentAdmitted',
      'recovered',
      'deaths',
    ]);

    for (const card of payload.cards) {
      expect(card.emphasis, card.key).toBe('important');
    }
    expect(payload.cards.filter((card) => card.emphasis === 'plain')).toEqual(
      [],
    );

    for (const key of [
      'onTreatment',
      'travellersScreened',
      'casesForReview',
      'samplesCollected',
      'signalsVerified',
      'contactsDueToday',
      'contactsFollowedUp',
    ]) {
      expect(
        payload.cards.find((card) => card.key === key),
        key,
      ).toBeUndefined();
    }
  });

  it('reports Alerts as a live total, with no suspected/probable breakdown', async () => {
    const { payload } = await runSummaryTab();
    const alerts = payload.cards.find((card) => card.key === 'alerts');

    expect(alerts?.label).toBe('Alerts');
    expect(alerts?.provenance.source).toBe('live');
    expect(alerts?.value).toBe(75);

    expect(alerts?.breakdown).toBeUndefined();
  });

  it('renders a measured zero as 0 with live provenance, never as a dash', async () => {
    const { payload } = await runSummaryTab();

    for (const key of ['confirmedCases', 'recovered', 'deaths']) {
      const card = payload.cards.find((entry) => entry.key === key);

      expect(card?.value, key).toBe(0);
      expect(card?.value, key).not.toBeNull();
      expect(card?.provenance.source, key).toBe('live');
      expect(card?.meta?.dataQualityStatus, key).not.toBe('unavailable');
    }
  });

  it('fixes current admitted at zero with a detail saying so, and still does not derive it', async () => {
    const { payload } = await runSummaryTab();

    expect(
      payload.cards.filter((card) => card.provenance.source === 'pending'),
    ).toEqual([]);

    const admitted = payload.cards.find(
      (card) => card.key === 'currentAdmitted',
    );

    expect(admitted?.label).toBe('Current admitted');
    expect(admitted?.value).toBe(0);
    expect(admitted?.detail).toBe(
      'Confirmed or probable cases currently admitted',
    );
    expect(admitted?.meta?.dataQualityStatus).not.toBe('unavailable');

    const { payload: derived } = await runSummaryTab(
      {},
      { outcomes: { on_treatment: 9 } },
    );
    expect(
      derived.cards.find((card) => card.key === 'currentAdmitted')?.value,
    ).toBe(0);
  });

  it('hangs the case fatality rate under the deaths count, as deaths over confirmed to one decimal', async () => {
    const { payload } = await runSummaryTab(
      {},
      {
        cases: { confirmed_cases: 37 },
        outcomes: { deaths: 4 },
      },
    );

    const deaths = payload.cards.find((card) => card.key === 'deaths');
    const confirmed = payload.cards.find(
      (card) => card.key === 'confirmedCases',
    );

    expect(deaths?.value).toBe(4);
    expect(confirmed?.value).toBe(37);
    expect(deaths?.breakdown).toEqual([
      {
        key: 'caseFatalityRate',
        label: 'Case fatality rate',
        value: 10.8,
        unit: 'percent',
      },
    ]);

    expect(
      payload.cards.map((card) => card.key).includes('caseFatalityRate'),
    ).toBe(false);

    expect(deaths?.detail).toBeNull();
    expect(deaths?.provenance.source).toBe('live');
  });

  it('dashes the case fatality rate where no confirmed case falls in the window', async () => {
    const { payload } = await runSummaryTab({}, { outcomes: { deaths: 4 } });

    const deaths = payload.cards.find((card) => card.key === 'deaths');
    const confirmed = payload.cards.find(
      (card) => card.key === 'confirmedCases',
    );

    expect(confirmed?.value).toBe(0);
    expect(deaths?.value).toBe(4);
    expect(deaths?.provenance.source).toBe('live');
    expect(deaths?.breakdown?.[0].value).toBeNull();
  });

  it('ships no empty-frame panel on the summary tab', async () => {
    const { payload } = await runSummaryTab();

    for (const chart of payload.charts) {
      expect(chart.provenance.source, chart.key).not.toBe('pending');
      expect(chart.meta?.dataQualityStatus, chart.key).not.toBe('unavailable');
      expect(chart.data.length, chart.key).toBeGreaterThan(0);
    }

    for (const key of ['workQueue', 'dataQualityFlags']) {
      expect(payload.meta.provenance[key], key).toBeUndefined();
    }
  });

  it('renders the Section 7.1 facility table with its six columns in order', async () => {
    const { payload } = await runSummaryTab();
    const breakdown = payload.breakdown;

    expect(breakdown).not.toBeNull();
    expect(breakdown?.title).toBe('Cases by health facility');

    expect(
      payload.charts.find((chart) => chart.key === 'facilityBreakdown'),
    ).toBeUndefined();

    expect(
      breakdown?.columns.map((column) => [
        column.key,
        column.label,
        column.align,
        column.pending,
      ]),
    ).toEqual([
      ['name', 'Facility', 'text', false],
      ['alerts', 'Alerts', 'num', false],
      ['confirmed', 'Confirmed', 'num', false],
      ['currentAdmitted', 'Current admitted', 'num', true],
      ['recovered', 'Recovered', 'num', false],
      ['deaths', 'Deaths', 'num', false],
    ]);

    expect(breakdown?.rows.length).toBeGreaterThan(0);
    for (const row of breakdown?.rows ?? []) {
      expect(row.currentAdmitted, String(row.name)).toBeNull();
      expect(row.unrecorded, String(row.name)).toBeUndefined();
    }

    expect(breakdown?.provenance.source).toBe('live');
    expect(payload.meta.provenance.facilityBreakdown.source).toBe('live');
  });

  it('emits the live flow and result-status panels beside them', async () => {
    const { payload } = await runSummaryTab();

    expect(payload.charts.map((chart) => chart.key)).toEqual([
      'dailyFlow',
      'sampleStatus',
    ]);

    const flow = payload.charts[0];
    expect(flow.kind).toBe('line');
    expect(flow.categoryKey).toBe('day');
    expect(flow.series.map((series) => series.key)).toEqual([
      'signals',
      'verified',
      'samples',
    ]);
    expect(flow.data).toEqual(SUMMARY_FLOW_ROWS);

    expect(payload.charts[1].data.map((row) => row.name)).toEqual([
      'Negative',
      'Positive',
    ]);
  });

  it('carries a facility dimension breakdown of its own', async () => {
    const { payload } = await runSummaryTab();

    expect(payload.breakdown).not.toBeNull();
    expect(payload.breakdown?.title).toBe('Cases by health facility');
    expect(payload.breakdown?.columns[0].key).toBe('name');
  });

  it('accepts the period and nothing else', async () => {
    const plain = await runSummaryTab();
    const withGeography = await runSummaryTab({
      county: 'Nairobi',
      subcounty: 'Westlands',
    });

    expect(withGeography.payload).toEqual(plain.payload);
    expect(Object.keys(plain.payload.meta.filters)).toEqual([
      'period',
      'from',
      'to',
    ]);
    for (const card of plain.payload.cards) {
      expect(card.meta?.allowedFilters).toEqual(['period']);
    }

    for (const provenance of Object.values(plain.payload.meta.provenance)) {
      expect(provenance.degraded).toBeUndefined();
    }
  });

  it('composes in bounded groups rather than one wide fan-out', async () => {
    const { queries, maxInFlight } = await runSummaryTab();

    expect(queries).toHaveLength(8);
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it('reads all six gold report marts and nothing outside gold', async () => {
    const { queries } = await runSummaryTab();
    const sql = queries.join('\n');

    for (const mart of [
      'gold.report_case_investigation',
      'gold.report_treatment_outcome',
      'gold.report_screening',
      'gold.report_community_signals',
      'gold.report_lab_result',
      'gold.report_contact_registration',
    ]) {
      expect(sql, mart).toContain(mart);
    }

    expect(sql).not.toMatch(/\b(bronze|silver)\./);
    expect(sql).not.toMatch(/\bmarts\./);
    expect(sql).not.toMatch(/SELECT\s+\*/);
  });

  it('writes no geography FILTER on any section, and groups by facility in exactly one', async () => {
    const { queries } = await runSummaryTab();
    const sql = queries.join('\n');

    expect(sql).not.toContain('reporting_county');
    expect(sql).not.toContain('reporting_subcounty');
    expect(sql).not.toMatch(/dim_facilitylist/);

    const facilityStatements = queries.filter((statement) =>
      statement.includes('health_facility'),
    );
    expect(facilityStatements).toHaveLength(1);
    expect(facilityStatements[0]).toContain('active_facilities AS');
    expect(facilityStatements[0]).toContain('GROUP BY');

    expect(facilityStatements[0]).not.toMatch(
      /health_facility\s*(=|<>|!=|~~|~|ilike\b|like\b|in\s*\()/i,
    );
  });

  it('anchors every section to its own mart and applies a custom range once per statement', async () => {
    const preset = await runSummaryTab({ period: '42d' });
    const presetSql = preset.queries.join('\n');

    expect(presetSql).toContain("bounds.max_event_at - interval '42 days'");
    expect(presetSql).toContain(
      "community_bounds.max_event_at - interval '42 days'",
    );
    expect(presetSql).toContain("lab_bounds.max_event_at - interval '42 days'");
    expect(presetSql).not.toContain('now()');
    expect(preset.payload.meta.window.anchored).toBe(true);

    const custom = await runSummaryTab({
      period: 'custom',
      from: '2026-07-01',
      to: '2026-07-25',
    });
    expect(custom.queries.join('\n')).not.toMatch(/max_event_at - interval/);
    expect(custom.payload.meta.window.anchored).toBe(false);

    const flow = custom.queries.find((sql) => sql.includes('community_daily AS'));
    expect(flow?.match(/event_at >= \$2::timestamptz/g)).toHaveLength(2);
    expect(flow?.match(/event_at <= \$3::timestamptz/g)).toHaveLength(2);
  });

  it('reports the widest window and the oldest ingestion across the six marts', async () => {
    const older = '2026-07-20T10:00:00Z';
    const { payload } = await runSummaryTab(
      {},
      { contacts: { last_updated: older } },
    );

    expect(payload.meta.window.from).toBe('2026-05-29');
    expect(payload.meta.window.to).toBe('2026-07-28');

    for (const card of payload.cards) {
      if (card.meta?.lastUpdated !== undefined) {
        expect(card.meta.lastUpdated).toBe(older);
      }
    }
  });

  it('renders measured numbers over an unrefreshed warehouse', async () => {
    const { payload } = await runSummaryTab({}, {
      cases: { last_updated: STALE_INGEST },
    });

    for (const card of payload.cards) {
      expect(card.meta?.dataQualityStatus, card.key).not.toBe('stale');
      expect(card.value, card.key).not.toBeNull();
    }
  });

  const AC07_CARD_OVERRIDES = {
    cases: {
      suspected: 87,
      probable: 3,
      alerts: 90,
      confirmed_cases: 34,
    },
    outcomes: { on_treatment: 0, recovered: 21, deaths: 7 },
  };

  const AC07_FACILITY_ROWS = [
    {
      name: 'Kenyatta National Hospital',
      alerts: 50,
      confirmed: 20,
      recovered: 12,
      deaths: 4,
      total_groups: 3,
    },
    {
      name: 'Mbagathi Hospital',
      alerts: 25,
      confirmed: 9,
      recovered: 5,
      deaths: 2,
      total_groups: 3,
    },
    {
      name: 'Not recorded',
      alerts: 15,
      confirmed: 5,
      recovered: 4,
      deaths: 1,
      total_groups: 3,
    },
  ];

  const AC07_PAIRS = [
    ['alerts', 'alerts'],
    ['confirmed', 'confirmedCases'],
    ['recovered', 'recovered'],
    ['deaths', 'deaths'],
  ] as const;

  it('reconciles every facility column total to its KPI card (AC-07)', async () => {
    const { payload } = await runSummaryTab(
      {},
      AC07_CARD_OVERRIDES,
      AC07_FACILITY_ROWS,
    );
    const breakdown = payload.breakdown;
    const cardValue = (key: string) =>
      payload.cards.find((card) => card.key === key)?.value;

    const cardValues = AC07_PAIRS.map(([, cardKey]) => cardValue(cardKey));
    for (const [index, [, cardKey]] of AC07_PAIRS.entries()) {
      expect(cardValues[index], cardKey).toBeGreaterThan(0);
    }
    expect(new Set(cardValues).size, 'card values are mutually distinct').toBe(
      AC07_PAIRS.length,
    );

    expect(breakdown?.shown).toBe(breakdown?.total);
    expect(breakdown?.rows).toHaveLength(3);

    for (const [columnKey, cardKey] of AC07_PAIRS) {
      const columnTotal = (breakdown?.rows ?? []).reduce(
        (total, row) => total + ((row[columnKey] as number | null) ?? 0),
        0,
      );
      expect(columnTotal, `${columnKey} totals to the ${cardKey} card`).toBe(
        cardValue(cardKey),
      );
    }

    const names = (breakdown?.rows ?? []).map((row) => row.name);
    expect(names).toContain('Not recorded');
    expect(names[names.length - 1]).toBe('Not recorded');
  });

  it('proves the Not recorded row is what makes AC-07 hold', async () => {
    const { payload } = await runSummaryTab(
      {},
      AC07_CARD_OVERRIDES,
      AC07_FACILITY_ROWS,
    );
    const breakdown = payload.breakdown;
    const namedRows = (breakdown?.rows ?? []).filter(
      (row) => row.name !== 'Not recorded',
    );

    expect(namedRows.length).toBeGreaterThan(1);

    for (const [columnKey, cardKey] of AC07_PAIRS) {
      const namedTotal = namedRows.reduce(
        (total, row) => total + ((row[columnKey] as number | null) ?? 0),
        0,
      );
      const card = payload.cards.find((entry) => entry.key === cardKey)?.value;

      expect(namedTotal, `${columnKey} without the bucket row`).toBeLessThan(
        card as number,
      );
    }
  });

  it('excludes a facility with no activity in the window (AC-14)', async () => {
    const { queries } = await runSummaryTab();
    const facilitySql = queries.find((statement) =>
      statement.includes('active_facilities AS'),
    );

    expect(facilitySql).toContain(
      'WHERE alerts + confirmed + recovered + deaths > 0',
    );

    expect(facilitySql?.indexOf('active_facilities AS')).toBeLessThan(
      facilitySql?.indexOf(
        'WHERE alerts + confirmed + recovered + deaths > 0',
      ) as number,
    );
  });

  it('degrades the community provenance when no signal is in scope', async () => {
    const { payload } = await runSummaryTab(
      {},
      {
        community: {
          signals_reported: 0,
          signals_verified: 0,
          verified_share: null,
        },
      },
    );

    expect(
      payload.cards.find((card) => card.key === 'signalsVerified'),
    ).toBeUndefined();
    expect(payload.meta.provenance.community.source).toBe('pending');
    expect(payload.meta.provenance.community.label).toContain('undefined');

    expect(nonFiniteValues(payload)).toEqual([]);
  });
});

function expectSuppressedDetail(payload: TabPayload, label: string) {
  for (const chart of payload.charts) {
    expect(chart.data, `${label} chart ${chart.key}`).toEqual([]);
    expect(chart.title.length).toBeGreaterThan(0);
  }

  const breakdown = payload.breakdown;
  if (!breakdown) return;

  const numericKeys = breakdown.columns
    .filter((column) => column.align === 'num')
    .map((column) => column.key);
  const labelKeys = breakdown.columns
    .filter((column) => column.align === 'text')
    .map((column) => column.key);

  expect(
    numericKeys.length,
    `${label} has numeric columns to null`,
  ).toBeGreaterThan(0);
  expect(breakdown.rows.length, `${label} has rows to check`).toBeGreaterThan(
    0,
  );

  for (const row of breakdown.rows) {
    for (const key of numericKeys) {
      expect(row[key], `${label} breakdown ${key}`).toBeNull();
    }
    for (const key of labelKeys) {
      expect(row[key], `${label} label ${key}`).not.toBeNull();
    }
  }
}

describe('suppression covers the chart and the breakdown, not only the cards', () => {
  it('suppresses a pending chart and a pending breakdown together', () => {
    const gap = pending('Awaiting a gold column');

    const chart = buildChart({
      key: 'gapChart',
      title: 'Gap',
      subtitle: null,
      kind: 'bar',
      orientation: 'vertical',
      height: 280,
      categoryKey: 'name',
      series: [{ key: 'value', label: 'Value', color: '#0369a1' }],
      data: [{ name: 'A', value: 1 }],
      provenance: gap,
    });
    const breakdown = buildBreakdown({
      title: 'Gap',
      columns: [
        { key: 'name', label: 'Name', align: 'text', pending: false },
        { key: 'value', label: 'Value', align: 'num', pending: false },
      ],
      rows: [{ name: 'A', value: 1 }],
      total: 1,
      shown: 1,
      provenance: gap,
    });

    expect(chart.data).toEqual([]);
    expect(breakdown.rows[0].name).toBe('A');
    expect(breakdown.rows[0].value).toBeNull();
  });

  it('leaves an unrefreshed tab fully rendered', async () => {
    const { payload } = await runLabsTab({}, STALE_INGEST);

    expect(payload.cards.every((card) => card.value !== null)).toBe(true);
    expect(payload.charts[0].data.length).toBeGreaterThan(0);
    expect(payload.breakdown?.rows[0].tests).not.toBeNull();
  });
});

describe('inBoundedGroups', () => {
  it('never exceeds the group size and preserves order', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const task = (value: number) => async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 0));
      inFlight -= 1;
      return value;
    };

    const results = await inBoundedGroups(
      [task(1), task(2), task(3), task(4), task(5), task(6), task(7)] as const,
      3,
    );

    expect(results).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(maxInFlight).toBe(3);
  });
});

describe('earliest / latest', () => {
  it('picks the chronological bound and tolerates a table with no rows in scope', () => {
    expect(earliest('2026-05-29', '2026-06-02')).toBe('2026-05-29');
    expect(latest('2026-07-08', '2026-07-10')).toBe('2026-07-10');
    expect(earliest(null, '2026-06-02')).toBe('2026-06-02');
    expect(latest('2026-07-08', null)).toBe('2026-07-08');
    expect(earliest(null, null)).toBeNull();
  });
});

describe('buildCard', () => {
  it('nulls the value and the detail for a pending provenance', () => {
    const card = buildCard({
      key: 'labs.notSourced',
      label: 'Not sourced',
      tone: 'blue',
      value: 42,
      detail: 'Would explain the gap',
      provenance: pending('Awaiting a gold column'),
    });

    expect(card.value).toBeNull();
    expect(card.detail).toBeNull();
    expect(card.unit).toBeNull();
  });

  it('nulls the value for an unavailable source rather than collapsing it to zero', () => {
    const card = buildCard({
      key: 'testsDone',
      label: 'Tests done',
      tone: 'blue',
      value: 436,
      provenance: source('Source: gold.report_lab_result'),
      meta: {
        indicatorId: 'labs.testsDone',
        displayName: 'No. of tests done',
        securityClassification: 'restricted aggregate',
        dataQualityStatus: 'unavailable',
      },
    });

    expect(card.value).toBeNull();
    expect(card.value).not.toBe(0);
  });

  it('keeps a genuine measured zero as zero', () => {
    const card = buildCard({
      key: 'positiveTests',
      label: 'Positive tests',
      tone: 'red',
      value: 0,
      provenance: source('Source: gold.report_lab_result'),
      meta: {
        indicatorId: 'labs.positiveTests',
        displayName: 'No. of positive tests',
        securityClassification: 'restricted aggregate',
        dataQualityStatus: 'validated',
      },
    });

    expect(card.value).toBe(0);
  });

  it('nulls the breakdown entry values with the total, keeping their labels', () => {
    const card = buildCard({
      key: 'alerts',
      label: 'Alerts',
      tone: 'red',
      emphasis: 'important',
      value: 75,
      breakdown: [
        { key: 'suspected', label: 'Suspected', value: 72 },
        { key: 'probable', label: 'Probable', value: 3 },
      ],
      provenance: source('Source: gold.report_case_investigation'),
      meta: {
        indicatorId: 'summary.alerts',
        displayName: 'Alerts',
        securityClassification: 'restricted aggregate',
        dataQualityStatus: 'unavailable',
      },
    });

    expect(card.value).toBeNull();
    expect(card.breakdown?.map((entry) => entry.value)).toEqual([null, null]);
    expect(card.breakdown?.map((entry) => entry.label)).toEqual([
      'Suspected',
      'Probable',
    ]);
  });

  it('keeps the breakdown entry values when the card is not suppressed', () => {
    const card = buildCard({
      key: 'alerts',
      label: 'Alerts',
      tone: 'red',
      emphasis: 'important',
      value: 75,
      breakdown: [
        { key: 'suspected', label: 'Suspected', value: 72 },
        { key: 'probable', label: 'Probable', value: 3 },
      ],
      provenance: source('Source: gold.report_case_investigation'),
      meta: {
        indicatorId: 'summary.alerts',
        displayName: 'Alerts',
        securityClassification: 'restricted aggregate',
        dataQualityStatus: 'validated',
      },
    });

    expect(card.value).toBe(75);
    expect(card.breakdown?.map((entry) => entry.value)).toEqual([72, 3]);
  });
});

describe('operationalFiltersSchema', () => {
  it('defaults the period and offers only the Health Facilities geography predicate', () => {
    const filters = parse({ facility: 'Suba Sub County Hospital' });

    expect(filters.period).toBe('21d');
    expect(filters.facility).toBe('Suba Sub County Hospital');
    expect(Object.keys(filters)).not.toContain('county');
    expect(Object.keys(filters)).not.toContain('subcounty');
    expect(Object.keys(filters)).not.toContain('ward');
  });

  it('rejects bounds supplied alongside a non-custom preset', () => {
    expect(() => parse({ period: '7d', from: '2026-07-01' })).toThrow();
  });

  it('requires both bounds for a custom range and rejects an inverted one', () => {
    expect(() => parse({ period: 'custom', from: '2026-07-01' })).toThrow();
    expect(() =>
      parse({ period: 'custom', from: '2026-07-25', to: '2026-07-01' }),
    ).toThrow();
  });

  it('rejects a custom range longer than a year', () => {
    expect(() =>
      parse({ period: 'custom', from: '2024-01-01', to: '2026-07-01' }),
    ).toThrow();
  });

  it('rejects the preset the meeting removed', () => {
    expect(() => parse({ period: '14d' })).toThrow();
  });
});
