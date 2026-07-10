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
      query: vi.fn((sql: string) => {
        queries.push(sql);

        if (sql.includes('greatest(')) {
          return rows([{ last_updated: new Date('2026-07-11T00:00:00.000Z') }]);
        }
        if (
          sql.includes('FROM gold.report_laboratory_summary') &&
          sql.includes('tests_24h')
        ) {
          return rows([
            {
              tests_done: 1089,
              positive: 63,
              negative: 1026,
              inconclusive: 0,
              unknown: 0,
              positivity_pct: 5.785,
              first_test: '2025-07-06',
              last_test: '2026-07-11',
              tests_24h: 6,
            },
          ]);
        }
        if (
          sql.includes('FROM gold.report_laboratory_summary') &&
          sql.includes('GROUP BY end_of_week')
        ) {
          return rows([
            { date: '2026-07-04', tests: 12, positive: 1, negative: 11 },
            { date: '2026-07-11', tests: 6, positive: 0, negative: 6 },
          ]);
        }
        if (
          sql.includes('FROM gold.report_case_summary') &&
          sql.includes('case_24h_window_end')
        ) {
          return rows([
            {
              total_cases: 5059,
              suspected: 66,
              probable: 0,
              confirmed: 0,
              deaths: 0,
              recoveries: 0,
              tested: 66,
              samples_collected: 14,
              with_specimen_id: 14,
              cases_24h: 382,
              confirmed_24h: 0,
              deaths_24h: 0,
              recoveries_24h: 0,
              case_24h_window_end: '2026-07-08T09:33:11',
            },
          ]);
        }
        if (
          sql.includes('FROM gold.report_case_trend') &&
          sql.includes('GROUP BY end_of_week')
        ) {
          return rows([
            {
              date: '2026-07-11',
              epi_week_label: '2026-W28',
              total_cases: 5059,
              suspected: 66,
              confirmed: 0,
              deaths: 0,
            },
          ]);
        }
        if (
          sql.includes('FROM gold.report_screening_summary') &&
          sql.includes('screened_24h')
        ) {
          return rows([
            {
              screening_records: 16809,
              total_screened: 16809,
              alerts: 66,
              confirmed: 0,
              tested: 0,
              screened_24h: 775,
              alerts_24h: 3,
              first_screening: '2026-07-02',
              last_screening: '2026-07-08',
            },
          ]);
        }
        if (
          sql.includes('FROM gold.report_screening_summary') &&
          sql.includes('GROUP BY 1')
        ) {
          return rows([
            {
              name: 'Jomo Kenyatta International Airport',
              screening_records: 500,
              screened: 500,
              alerts: 2,
              confirmed: 0,
              tested: 0,
            },
          ]);
        }
        if (
          sql.includes('FROM gold.report_geographic_summary') &&
          sql.includes('GROUP BY 1')
        ) {
          return rows([
            {
              county: 'Nairobi',
              total_cases: 6,
              confirmed: 0,
              deaths: 0,
              screening_records: 10,
              screened: 10,
              lab_tests: 399,
              laboratory_positivity_rate: 0,
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
      'gold.report_laboratory_summary',
    );
    expect(payload.labs.testsDone).toBe(1089);
    expect(payload.labs.newTested24h).toBe(6);
    expect(payload.labs.pendingResults).toBeNull();
    expect(payload.cases.totalCases).toBe(5059);
    expect(payload.cases.newCases24h).toBe(382);
    expect(payload.cases.admitted).toBeNull();
    expect(payload.poe.totalScreened).toBe(16809);
    expect(payload.poe.newScreened24h).toBe(775);
    expect(payload.poe.uniqueTravelers).toBeNull();
    expect(payload.geography.byCounty[0].county).toBe('Nairobi');
    expect(queries.join('\n')).toContain('gold.');
    expect(queries.join('\n')).not.toMatch(/\b(bronze|silver|marts)\./);
  });
});
