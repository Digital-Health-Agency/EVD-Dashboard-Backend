import { describe, expect, it, vi } from 'vitest';

import type { Queryable } from '../../database/database.module.js';
import { AnalyticsService } from './analytics.service.js';

function rows<T>(data: T[]) {
  return Promise.resolve({ rows: data, rowCount: data.length });
}

describe('AnalyticsService', () => {
  it('maps backend gold analytics into the dashboard payload', async () => {
    const queries: string[] = [];
    const db: Queryable = {
      query: vi.fn((sql: string, values?: unknown[]) => {
        queries.push(sql);

        if (sql.includes('FROM gold.report_lab_result')) {
          expect(sql).toContain('test_code = $1');
          expect(values).toEqual(['86518-8']);
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

    const service = new AnalyticsService(db);
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
    expect(payload.geography.byCounty[0].county).toBe('Nairobi');
    expect(payload.geography.byCounty[0].laboratoryPositivityRate).toBeNull();
    expect(queries.join('\n')).toContain('gold.');
    expect(queries.join('\n')).not.toMatch(/\b(bronze|silver|marts)\./);
    expect(queries.join('\n')).not.toMatch(
      /report_(case_summary|case_trend|laboratory_summary|screening_summary|geographic_summary)/,
    );
  });
});
