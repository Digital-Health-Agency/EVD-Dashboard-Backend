import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { newDb } from 'pg-mem';

import { source } from '../../common/analytics-helpers.js';
import {
  DatabaseService,
  type Queryable,
} from '../../database/database.module.js';
import { AuditService } from '../audit/audit.service.js';
import {
  applyHeadlineOverride,
  hasAnyFigure,
  overrideValue,
  warehouseHeadlineFigures,
} from '../reconciliation/headline-override-merge.js';
import {
  HEADLINE_FIGURE_FIELDS,
  type HeadlineFigures,
  type HeadlineOverrideRow,
} from '../reconciliation/headline-override.schema.js';
import { HeadlineOverrideService } from '../reconciliation/headline-override.service.js';
import { AnalyticsService } from './analytics.service.js';

function rows<T>(data: T[]) {
  return Promise.resolve({ rows: data, rowCount: data.length });
}

const SURVEILLANCE_START = '2026-05-15';

interface Call {
  sql: string;
  values?: unknown[];
}

const SEEDED_ROW: HeadlineOverrideRow = {
  situation_date: '2026-10-06',
  report_date: '2026-10-06',
  source_label: 'CS press release 6 Oct 2026',
  notes: null,
  confirmed_cases: 1,
  confirmed_cases_24h: 1,
  recoveries: 0,
  deaths: 1,
  samples_tested_total: 267,
  samples_tested_24h: null,
  positive_samples: 1,
  negative_samples: 266,
  travellers_screened_total: 652584,
  travellers_screened_24h: null,
  screening_points: null,
  contacts_listed: 28,
  updatedBy: null,
};

function withFigures(figures: Partial<HeadlineFigures>): HeadlineOverrideRow {
  const blank = Object.fromEntries(
    HEADLINE_FIGURE_FIELDS.map((key) => [key, null]),
  ) as HeadlineFigures;
  return { ...SEEDED_ROW, ...blank, ...figures };
}

function overridesStub(series: HeadlineOverrideRow[] = []) {
  return {
    list: vi.fn(async () => series),
  } as unknown as HeadlineOverrideService;
}

function goldDb() {
  const queries: string[] = [];
  const calls: Call[] = [];
  const db: Queryable = {
    query: vi.fn((sql: string, values?: unknown[]) => {
      queries.push(sql);
      calls.push({ sql, values });

      if (
        sql.includes('FROM gold.report_lab_result') &&
        !sql.includes(') updates')
      ) {
        expect(sql).toContain('test_code = $1');
        expect(values).toEqual(['86518-8', SURVEILLANCE_START]);
      }

      if (sql.includes('max(updated_at)') && sql.includes(') updates')) {
        return rows([{ last_updated: '2026-07-16' }]);
      }
      if (
        sql.includes('FROM gold.report_lab_result') &&
        sql.includes('avg_tat_days')
      ) {
        return rows([
          {
            tests_done: 163,
            positive: 0,
            negative: 163,
            inconclusive: 0,
            other: 0,
            unknown: 0,
            pending: 0,
            positivity_pct: 0,
            patients_tested: 159,
            avg_tat_days: 149.3,
            first_test: '2025-09-05',
            last_test: '2026-07-16',
            tests_24h: 1,
          },
        ]);
      }
      if (
        sql.includes('FROM gold.report_lab_result') &&
        sql.includes('period_end')
      ) {
        return rows([
          { date: '2026-07-11', tests: 9, positive: 0, negative: 9 },
          { date: '2026-07-18', tests: 5, positive: 0, negative: 5 },
        ]);
      }
      if (
        sql.includes('FROM gold.report_case_investigation') &&
        sql.includes('case_24h_window_end')
      ) {
        return rows([
          {
            total_cases: 74,
            suspected: 74,
            probable: 0,
            confirmed: 0,
            deaths: 0,
            recoveries: 0,
            tested: 61,
            samples_collected: 61,
            with_specimen_id: 61,
            cases_24h: 1,
            confirmed_24h: 0,
            deaths_24h: 0,
            recoveries_24h: 0,
            contacts_listed: 59,
            case_24h_window_end: '2026-07-10T13:24:13',
          },
        ]);
      }
      if (
        sql.includes('FROM gold.report_case_investigation') &&
        sql.includes('case_weekly')
      ) {
        return rows([
          {
            date: '2026-07-11',
            epi_week_label: '2026-W28',
            total_cases: 74,
            suspected: 74,
            confirmed: 0,
            deaths: 0,
          },
        ]);
      }
      if (
        sql.includes('FROM gold.report_screening') &&
        sql.includes('screened_24h')
      ) {
        return rows([
          {
            screening_records: 117687,
            total_screened: 117687,
            alerts: 2,
            suspected: 2,
            confirmed: 0,
            tested: 0,
            screened_24h: 1116,
            alerts_24h: 0,
            first_screening: '2026-05-05',
            last_screening: '2026-07-15',
          },
        ]);
      }
      if (
        sql.includes('FROM gold.report_screening') &&
        sql.includes('screening_daily')
      ) {
        return rows([
          { date: '2026-07-15', screened: 1116, alerts: 0 },
          { date: '2026-07-14', screened: 980, alerts: 1 },
        ]);
      }
      if (
        sql.includes('FROM gold.report_screening') &&
        sql.includes('GROUP BY 1')
      ) {
        return rows([
          {
            name: 'Jomo Kenyatta International Airport',
            screening_records: 500,
            screened: 500,
            alerts: 2,
            suspected: 2,
            confirmed: 0,
            tested: 0,
          },
        ]);
      }
      if (
        sql.includes('geographic_activity') &&
        sql.includes('FROM gold.report_treatment_outcome')
      ) {
        return rows([
          {
            county: 'Nairobi',
            total_cases: 6,
            confirmed: 0,
            deaths: 0,
            screening_records: 0,
            screened: 0,
            lab_tests: 0,
            laboratory_positivity_rate: null,
          },
        ]);
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    }),
  };
  return { db, queries, calls };
}

describe('AnalyticsService', () => {
  it('maps backend gold analytics into the dashboard payload', async () => {
    const { db, queries, calls } = goldDb();

    const service = new AnalyticsService(db, overridesStub());
    const payload = await service.getMetrics();

    expect(payload.meta.adapter).toBe('backend-postgres');
    expect(payload.meta.provenance.labs.label).toContain(
      'gold.report_lab_result',
    );
    expect(payload.meta.provenance.clinical.source).toBe('live');
    expect(payload.labs.testsDone).toBe(163);
    expect(payload.labs.positive).toBe(0);
    expect(payload.labs.patientsTested).toBe(159);
    expect(payload.labs.avgTatDays).toBe(149.3);
    expect(payload.labs.newTested24h).toBe(1);
    expect(payload.labs.pendingResults).toBe(0);
    expect(payload.cases.totalCases).toBe(74);
    expect(payload.cases.contactsListed).toBe(59);
    expect(payload.cases.newCases24h).toBe(1);
    expect(payload.cases.admitted).toBeNull();
    expect(payload.poe.totalScreened).toBe(117687);
    expect(payload.poe.alerts).toBe(2);
    expect(payload.poe.newScreened24h).toBe(1116);
    expect(payload.poe.uniqueTravelers).toBeNull();
    expect(payload.poe.trend.map((point) => point.date)).toEqual([
      '2026-07-14',
      '2026-07-15',
    ]);
    expect(payload.geography.byCounty[0].county).toBe('Nairobi');
    expect(payload.geography.byCounty[0].laboratoryPositivityRate).toBeNull();
    expect(queries.join('\n')).toContain('gold.');
    expect(queries.join('\n')).not.toMatch(/\b(bronze|silver|marts)\./);
    expect(queries.join('\n')).not.toMatch(
      /report_(case_summary|case_trend|laboratory_summary|screening_summary|geographic_summary)/,
    );

    const aggregates = calls.filter((call) => !call.sql.includes(') updates'));
    expect(aggregates.length).toBe(calls.length - 1);
    for (const call of aggregates) {
      const label = call.sql.slice(0, 80);
      expect(call.sql, label).toMatch(/>= \$\d+::timestamptz/);
      expect(call.values, label).toContain(SURVEILLANCE_START);
    }

    const freshness = calls.find((call) => call.sql.includes(') updates'));
    expect(freshness).toBeDefined();
    expect(freshness?.sql).not.toMatch(/>= \$\d+::timestamptz/);
    expect(freshness?.values).toEqual(['86518-8']);
  });

  it('floors the 24-hour deltas by flooring the rows they are taken over', async () => {
    const calls: Call[] = [];
    const db: Queryable = {
      query: vi.fn((sql: string, values?: unknown[]) => {
        calls.push({ sql, values });
        return rows([]);
      }),
    };

    await new AnalyticsService(db, overridesStub()).getMetrics();

    const deltas = calls.filter((call) =>
      call.sql.includes("interval '24 hours'"),
    );
    expect(deltas.length).toBeGreaterThan(0);
    for (const call of deltas) {
      expect(call.sql).toContain('max_event_at');
      expect(call.sql).not.toContain('now()');
      expect(call.sql).toMatch(/>= \$\d+::timestamptz/);
      expect(call.values).toContain(SURVEILLANCE_START);
    }
  });

  it('dates lastUpdated in Kenyan local time, not UTC', async () => {
    const calls: Call[] = [];
    const db: Queryable = {
      query: vi.fn((sql: string, values?: unknown[]) => {
        calls.push({ sql, values });
        return rows([]);
      }),
    };

    await new AnalyticsService(db, overridesStub()).getMetrics();

    const lastUpdated = calls.find((call) => call.sql.includes(') updates'));
    expect(lastUpdated).toBeDefined();
    expect(lastUpdated!.sql).toContain("AT TIME ZONE 'Africa/Nairobi'");
    expect(lastUpdated!.sql).not.toContain("AT TIME ZONE 'UTC'");
  });

  it('reports no lastUpdated when the warehouse is empty', async () => {
    const db: Queryable = {
      query: vi.fn(() => rows([])),
    };

    const metrics = await new AnalyticsService(
      db,
      overridesStub(),
    ).getMetrics();

    expect(metrics.meta.lastUpdated).toBeNull();
  });
});

function warehousePayload() {
  return {
    meta: {
      lastUpdated: '2026-07-16T00:00:00.000Z' as string | null,
      provenance: {
        cases: source('Source: gold.report_case_investigation'),
        labs: source('Source: gold.report_lab_result'),
        poe: source('Source: gold.report_screening'),
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
      trend: [{ date: '2026-07-15', screened: 1116, alerts: 0 }],
    },
  };
}

describe('headline override merge', () => {
  it.each([
    [null, 7, 7],
    [undefined, 7, 7],
    [0, 7, 0],
    [1, 7, 1],
  ])('overrideValue(%s, %s) is %s', (entered, warehouse, expected) => {
    expect(overrideValue(entered, warehouse)).toBe(expected);
  });

  it('treats a row as carrying a figure only when one is non-null, zero included', () => {
    expect(hasAnyFigure(withFigures({}))).toBe(false);
    expect(hasAnyFigure(withFigures({ positive_samples: 0 }))).toBe(true);
    expect(hasAnyFigure(null)).toBe(false);
  });

  it('leaves warehouse figures alone for an empty series and counts the known screening points', () => {
    const payload = warehousePayload();

    const merged = applyHeadlineOverride(payload, []);

    expect(merged.poe.screeningPoints).toBe(2);
    expect(merged.meta.lastUpdated).toBe('2026-07-16T00:00:00.000Z');
    expect(merged.meta.provenance).toEqual(payload.meta.provenance);
    expect(merged.cases).toEqual(payload.cases);
    expect(merged.labs).toEqual(payload.labs);
  });

  it('replaces every figure the official row carries and dates the payload by it', () => {
    const payload = warehousePayload();

    const merged = applyHeadlineOverride(payload, [SEEDED_ROW]);

    expect(merged.cases.confirmed).toBe(1);
    expect(merged.cases.newConfirmed24h).toBe(1);
    expect(merged.cases.recoveries).toBe(0);
    expect(merged.cases.deaths).toBe(1);
    expect(merged.cases.contactsListed).toBe(28);
    expect(merged.labs.testsDone).toBe(267);
    expect(merged.labs.positive).toBe(1);
    expect(merged.labs.negative).toBe(266);
    expect(merged.poe.totalScreened).toBe(652584);
    expect(merged.labs.newTested24h).toBe(4);
    expect(merged.poe.newScreened24h).toBe(1116);
    expect(merged.poe.screeningPoints).toBe(2);
    expect(merged.meta.lastUpdated).toBe('2026-10-06T00:00:00.000Z');
    expect(merged.cases.available).toBe(true);
    expect(merged.labs.available).toBe(true);
    expect(merged.poe.available).toBe(true);
    expect(merged.meta.provenance).toEqual(payload.meta.provenance);
    expect(JSON.stringify(merged.meta)).not.toMatch(/override/i);
  });

  it('uses neither the figures nor the date of a row with nothing entered', () => {
    const payload = warehousePayload();

    const merged = applyHeadlineOverride(payload, [withFigures({})]);

    expect(merged.cases).toEqual(payload.cases);
    expect(merged.labs).toEqual(payload.labs);
    expect(merged.poe).toEqual({ ...payload.poe, screeningPoints: 2 });
    expect(merged.meta.lastUpdated).toBe('2026-07-16T00:00:00.000Z');
  });

  it('lets a stored zero win over a non-zero warehouse figure', () => {
    const merged = applyHeadlineOverride(warehousePayload(), [
      withFigures({ positive_samples: 0 }),
    ]);

    expect(merged.labs.positive).toBe(0);
    expect(merged.labs.testsDone).toBe(163);
    expect(merged.meta.lastUpdated).toBe('2026-10-06T00:00:00.000Z');
  });

  it('takes the entered screening points over the derived count', () => {
    const merged = applyHeadlineOverride(warehousePayload(), [
      withFigures({ screening_points: 15 }),
    ]);

    expect(merged.poe.screeningPoints).toBe(15);
  });

  it('carries earlier cumulative figures into a partial newest row', () => {
    const merged = applyHeadlineOverride(warehousePayload(), [
      withFigures({ deaths: 1 }),
      {
        ...withFigures({ deaths: 9, recoveries: 9 }),
        situation_date: '2026-10-04',
      },
    ]);

    expect(merged.cases.deaths).toBe(1);
    expect(merged.cases.recoveries).toBe(9);
  });

  it('never mutates the payload it was given', () => {
    const payload = warehousePayload();
    const before = structuredClone(payload);

    const merged = applyHeadlineOverride(payload, [SEEDED_ROW]);

    expect(payload).toEqual(before);
    expect(merged).not.toBe(payload);
    expect(merged.cases).not.toBe(payload.cases);
  });
});

describe('AnalyticsService headline override', () => {
  it('serves a stored official row read through the real table and service', async () => {
    const pool: Pool = new (newDb().adapters.createPg().Pool)();
    try {
      const database = new DatabaseService(pool);
      await database.ensureSchema();
      const columns = [
        'situation_date',
        'report_date',
        'source_label',
        'notes',
        ...HEADLINE_FIGURE_FIELDS,
      ] as const;
      await database.query(
        `INSERT INTO headline_overrides (${columns.join(', ')}) VALUES (${columns
          .map((_, index) => `$${index + 1}`)
          .join(', ')})`,
        columns.map((column) => SEEDED_ROW[column]),
      );
      const overrides = new HeadlineOverrideService(
        database,
        new AuditService(pool),
      );
      const analyticsSql: string[] = [];
      const analytics: Queryable = {
        query: vi.fn((sql: string) => {
          analyticsSql.push(sql);
          return rows([]);
        }),
      };

      const payload = await new AnalyticsService(
        analytics,
        overrides,
      ).getMetrics();

      expect(payload.cases.confirmed).toBe(1);
      expect(payload.cases.deaths).toBe(1);
      expect(payload.cases.contactsListed).toBe(28);
      expect(payload.labs.testsDone).toBe(267);
      expect(payload.poe.totalScreened).toBe(652584);
      expect(payload.meta.lastUpdated).toBe('2026-10-06T00:00:00.000Z');
      expect(analyticsSql.length).toBeGreaterThan(0);
      for (const sql of analyticsSql) {
        expect(sql).not.toMatch(/^\s*(insert|update|delete)\b/i);
        expect(sql).not.toContain('headline_overrides');
      }
    } finally {
      await pool.end();
    }
  });

  it('adds the screening point count and changes nothing else for an empty series', async () => {
    const { db } = goldDb();

    const payload = await new AnalyticsService(
      db,
      overridesStub(),
    ).getMetrics();

    expect(payload.poe.screeningPoints).toBe(1);
    expect(payload.labs.testsDone).toBe(163);
    expect(payload.cases.contactsListed).toBe(59);
    expect(payload.poe.totalScreened).toBe(117687);
    expect(payload.meta.lastUpdated).toBe('2026-07-16T00:00:00.000Z');
  });

  it('serves warehouse figures and logs once when the series cannot be read', async () => {
    const expected = await new AnalyticsService(
      goldDb().db,
      overridesStub(),
    ).getMetrics();
    const failing = {
      list: () =>
        Promise.reject(
          new Error('relation "headline_overrides" does not exist'),
        ),
    } as unknown as HeadlineOverrideService;
    const service = new AnalyticsService(goldDb().db, failing);
    const logger = { error: vi.fn(), warn: vi.fn(), log: vi.fn() };
    (service as unknown as { logger: typeof logger }).logger = logger;

    const payload = await service.getMetrics();

    expect(payload).toEqual(expected);
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [message] = logger.error.mock.calls[0] as [string, string?];
    expect(message).toContain('headline override read failed');
    expect(message).toContain('headline_overrides');
  });

  it('leaves provenance exactly as the warehouse build produced it', async () => {
    const unmerged = await new AnalyticsService(
      goldDb().db,
      overridesStub(),
    ).getMetrics();

    const merged = await new AnalyticsService(
      goldDb().db,
      overridesStub([SEEDED_ROW]),
    ).getMetrics();

    expect(merged.cases.confirmed).toBe(1);
    expect(merged.meta.provenance).toEqual(unmerged.meta.provenance);
    expect(JSON.stringify(merged.meta)).not.toMatch(/override/i);
  });

  it('ignores a row dated after today in Nairobi', async () => {
    const future: HeadlineOverrideRow = {
      ...withFigures({ confirmed_cases: 0, deaths: 0, contacts_listed: 0 }),
      situation_date: '2099-01-01',
    };

    const expected = await new AnalyticsService(
      goldDb().db,
      overridesStub([SEEDED_ROW]),
    ).getMetrics();
    const payload = await new AnalyticsService(
      goldDb().db,
      overridesStub([future, SEEDED_ROW]),
    ).getMetrics();

    expect(payload).toEqual(expected);
    expect(payload.cases.confirmed).toBe(1);
    expect(payload.cases.deaths).toBe(1);
    expect(payload.meta.lastUpdated).not.toContain('2099');
  });

  it('serves warehouse figures when every row is dated after today', async () => {
    const future: HeadlineOverrideRow = {
      ...SEEDED_ROW,
      situation_date: '2099-01-01',
    };

    const expected = await new AnalyticsService(
      goldDb().db,
      overridesStub(),
    ).getMetrics();
    const payload = await new AnalyticsService(
      goldDb().db,
      overridesStub([future]),
    ).getMetrics();

    expect(payload).toEqual(expected);
  });

  it('applies a row dated today in Nairobi while UTC is still on yesterday', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-06T21:30:00Z'));
    try {
      const today: HeadlineOverrideRow = {
        ...withFigures({ confirmed_cases: 2 }),
        situation_date: '2026-10-07',
      };
      const tomorrow: HeadlineOverrideRow = {
        ...withFigures({ confirmed_cases: 9 }),
        situation_date: '2026-10-08',
      };

      const payload = await new AnalyticsService(
        goldDb().db,
        overridesStub([tomorrow, today, SEEDED_ROW]),
      ).getMetrics();

      expect(payload.cases.confirmed).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a future screening count out of the trend', async () => {
    const future: HeadlineOverrideRow = {
      ...withFigures({ travellers_screened_24h: 77 }),
      situation_date: '2099-01-01',
    };

    const payload = await new AnalyticsService(
      goldDb().db,
      overridesStub([future]),
    ).getMetrics();

    expect(payload.poe.trend.map((point) => point.date)).not.toContain(
      '2099-01-01',
    );
  });

  it('hands the analytics pool nothing but reads while merging', async () => {
    const { db, queries } = goldDb();

    await new AnalyticsService(db, overridesStub([SEEDED_ROW])).getMetrics();

    expect(queries.length).toBeGreaterThan(0);
    for (const sql of queries) {
      expect(sql).not.toMatch(/^\s*(insert|update|delete)\b/i);
    }
  });
});

describe('AnalyticsService screening trend', () => {
  const WAREHOUSE_TREND = [
    { date: '2026-07-14', screened: 980, alerts: 1 },
    { date: '2026-07-15', screened: 1116, alerts: 0 },
  ];

  function screenedOn(
    situationDate: string,
    screened: number,
  ): HeadlineOverrideRow {
    return {
      ...withFigures({ travellers_screened_24h: screened }),
      situation_date: situationDate,
    };
  }

  it('serves entered 24h counts on their dates and warehouse counts elsewhere', async () => {
    const series = [
      screenedOn('2026-07-20', 42),
      screenedOn('2026-07-14', 999),
    ];

    const payload = await new AnalyticsService(
      goldDb().db,
      overridesStub(series),
    ).getMetrics();

    expect(payload.poe.trend.map((point) => point.date)).toEqual([
      '2026-07-14',
      '2026-07-15',
      '2026-07-20',
    ]);
    expect(payload.poe.trend[0]).toEqual({
      date: '2026-07-14',
      screened: 999,
      alerts: 1,
    });
    expect(payload.poe.trend[1]).toEqual(WAREHOUSE_TREND[1]);
    expect(payload.poe.trend[2]).toEqual({
      date: '2026-07-20',
      screened: 42,
      alerts: 0,
    });
  });

  it('serves the warehouse trend for an empty series', async () => {
    const payload = await new AnalyticsService(
      goldDb().db,
      overridesStub(),
    ).getMetrics();

    expect(payload.poe.trend.map((point) => point.date)).toEqual([
      '2026-07-14',
      '2026-07-15',
    ]);
    expect(payload.poe.trend).toEqual(WAREHOUSE_TREND);
  });

  it('serves the warehouse trend when the series cannot be read', async () => {
    const failing = {
      list: () => Promise.reject(new Error('auth pool unavailable')),
    } as unknown as HeadlineOverrideService;
    const service = new AnalyticsService(goldDb().db, failing);
    const logger = { error: vi.fn(), warn: vi.fn(), log: vi.fn() };
    (service as unknown as { logger: typeof logger }).logger = logger;

    const payload = await service.getMetrics();

    expect(payload.poe.trend).toEqual(WAREHOUSE_TREND);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('leaves the trend alone for the official row, which reports no 24h count', async () => {
    const payload = await new AnalyticsService(
      goldDb().db,
      overridesStub([SEEDED_ROW]),
    ).getMetrics();

    expect(SEEDED_ROW.travellers_screened_24h).toBeNull();
    expect(payload.poe.trend).toEqual(WAREHOUSE_TREND);
    expect(payload.poe.totalScreened).toBe(652584);
  });

  it('adds no second series and no provenance marker to the trend', async () => {
    const unmerged = await new AnalyticsService(
      goldDb().db,
      overridesStub(),
    ).getMetrics();

    const merged = await new AnalyticsService(
      goldDb().db,
      overridesStub([screenedOn('2026-07-14', 999)]),
    ).getMetrics();

    expect(merged.poe.trend[0].screened).toBe(999);
    expect(Object.keys(merged.poe).sort()).toEqual(
      Object.keys(unmerged.poe).sort(),
    );
    expect(Object.keys(merged.poe.trend[0]).sort()).toEqual([
      'alerts',
      'date',
      'screened',
    ]);
    expect(merged.meta.provenance).toEqual(unmerged.meta.provenance);
    expect(JSON.stringify(merged)).not.toMatch(/override/i);
  });
});

describe('warehouse headline comparison', () => {
  it('reads all twelve figures back from the fields the public payload uses', () => {
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
    expect(figures).toEqual({
      confirmed_cases: 0,
      confirmed_cases_24h: 0,
      recoveries: 3,
      deaths: 0,
      samples_tested_total: 163,
      samples_tested_24h: 4,
      positive_samples: 5,
      negative_samples: 158,
      travellers_screened_total: 117687,
      travellers_screened_24h: 1116,
      screening_points: 2,
      contacts_listed: 59,
    });
  });

  it('reports a figure the warehouse does not carry as null, never as zero', () => {
    const figures = warehouseHeadlineFigures({
      cases: { confirmed: Number.NaN },
      labs: {},
      poe: {},
      poeRows: [],
    });

    expect(figures.confirmed_cases).toBeNull();
    expect(figures.samples_tested_total).toBeNull();
    expect(figures.travellers_screened_total).toBeNull();
    expect(figures.screening_points).toBe(0);
  });

  it('returns the unmerged warehouse figures while a series row is stored', async () => {
    const { db } = goldDb();
    const overrides = overridesStub([SEEDED_ROW]);

    const headline = await new AnalyticsService(
      db,
      overrides,
    ).getWarehouseHeadline();

    expect(headline.figures.confirmed_cases).toBe(0);
    expect(headline.figures.deaths).toBe(0);
    expect(headline.figures.samples_tested_total).toBe(163);
    expect(headline.figures.samples_tested_24h).toBe(1);
    expect(headline.figures.negative_samples).toBe(163);
    expect(headline.figures.travellers_screened_total).toBe(117687);
    expect(headline.figures.travellers_screened_24h).toBe(1116);
    expect(headline.figures.contacts_listed).toBe(59);
    expect(headline.figures.screening_points).toBe(1);
    expect(headline.lastUpdated).toBe('2026-07-16T00:00:00.000Z');
    expect(overrides.list).not.toHaveBeenCalled();
  });

  it('hands the analytics pool nothing but reads for the comparison', async () => {
    const { db, queries } = goldDb();

    await new AnalyticsService(
      db,
      overridesStub([SEEDED_ROW]),
    ).getWarehouseHeadline();

    expect(queries.length).toBeGreaterThan(0);
    for (const sql of queries) {
      expect(sql).not.toMatch(/^\s*(insert|update|delete)\b/i);
    }
  });
});
