import { Inject, Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';

import {
  ANALYTICS_POSTGRES_POOL,
  type Queryable,
} from '../../database/database.module.js';

type SourceState = 'live' | 'pending' | 'na';

interface Provenance {
  source: SourceState;
  label: string;
  degraded?: boolean;
}

interface NumberRow extends QueryResultRow {
  [key: string]: unknown;
}

const GOLD_SOURCE = 'gold analytics warehouse';
const EVD_LAB_TEST_CODE = '86518-8';

function num(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNum(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateString(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value.slice(0, 10);
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value).slice(0, 10);
  }
  return null;
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  return null;
}

function source(label: string): Provenance {
  return { source: 'live', label };
}

function pending(label: string): Provenance {
  return { source: 'pending', label };
}

@Injectable()
export class AnalyticsService {
  constructor(
    @Inject(ANALYTICS_POSTGRES_POOL) private readonly analyticsDb: Queryable,
  ) {}

  async getMetrics() {
    const [
      lastUpdated,
      labs,
      labTrend,
      cases,
      caseTrend,
      poe,
      poeRows,
      geographyRows,
    ] = await Promise.all([
      this.lastUpdated(),
      this.labSummary(),
      this.labTrend(),
      this.caseSummary(),
      this.caseTrend(),
      this.poeSummary(),
      this.poeRows(),
      this.geographyRows(),
    ]);

    return {
      meta: {
        country: 'Kenya',
        disease: 'Ebola',
        lastUpdated,
        adapter: 'backend-postgres',
        provenance: {
          cases: source(
            'Source: gold.report_case_investigation / gold.report_contact_registration / gold.report_treatment_outcome',
          ),
          labs: source(
            'Source: gold.report_lab_result (EVD test code 86518-8)',
          ),
          poe: source('Source: gold.report_screening'),
          geography: source(
            'Source: gold.report_case_investigation / gold.report_treatment_outcome',
          ),
          readiness: pending('Awaiting gold readiness indicators'),
          clinical: source('Source: gold.report_treatment_outcome'),
          community: pending('Awaiting gold community signal indicators'),
        },
      },
      labs: {
        ...labs,
        trend: labTrend,
      },
      cases: {
        ...cases,
        trend: caseTrend,
      },
      poe: {
        ...poe,
        byPoe: poeRows,
      },
      geography: {
        available: geographyRows.length > 0,
        byCounty: geographyRows,
      },
      readiness: {
        available: false,
        metrics: [],
      },
      source: GOLD_SOURCE,
    };
  }

  private async one<T extends NumberRow>(
    sql: string,
    values?: unknown[],
  ): Promise<T> {
    const result = await this.analyticsDb.query<T>(sql, values);
    return result.rows[0] ?? ({} as T);
  }

  private async many<T extends NumberRow>(
    sql: string,
    values?: unknown[],
  ): Promise<T[]> {
    const result = await this.analyticsDb.query<T>(sql, values);
    return result.rows;
  }

  private async lastUpdated(): Promise<string> {
    const row = await this.one<{ last_updated: string | null }>(
      `
      SELECT to_char(max(updated_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS last_updated
      FROM (
        SELECT max(coalesce(investigation_datetime, reporting_date::timestamptz)) AS updated_at
        FROM gold.report_case_investigation
        UNION ALL
        SELECT max(coalesce(registration_datetime, registration_date::timestamptz))
        FROM gold.report_contact_registration
        UNION ALL
        SELECT max(coalesce(result_datetime, reporting_result_date::timestamptz, collection_date::timestamptz))
        FROM gold.report_lab_result
        WHERE test_code = $1
        UNION ALL
        SELECT max(coalesce(screening_datetime, reporting_date::timestamptz))
        FROM gold.report_screening
        UNION ALL
        SELECT max(coalesce(outcome_recorded_datetime, outcome_date::timestamptz, reporting_date::timestamptz))
        FROM gold.report_treatment_outcome
      ) updates
    `,
      [EVD_LAB_TEST_CODE],
    );
    const lastUpdated = row.last_updated;
    if (!lastUpdated) return new Date().toISOString();
    return `${lastUpdated}T00:00:00.000Z`;
  }

  private async labSummary() {
    const row = await this.one(
      `
      WITH base AS (
        SELECT
          *,
          coalesce(
            result_datetime,
            reporting_result_date::timestamptz,
            collection_date::timestamptz
          ) AS event_at
        FROM gold.report_lab_result
        WHERE test_code = $1
      ),
      bounds AS (
        SELECT max(event_at) AS max_event_at
        FROM base
      )
      SELECT
        coalesce(sum(total_test_count), 0)::int AS tests_done,
        coalesce(sum(positive_test_count), 0)::int AS positive,
        coalesce(sum(negative_test_count), 0)::int AS negative,
        coalesce(sum(inconclusive_test_count), 0)::int AS inconclusive,
        coalesce(sum(other_result_count), 0)::int AS other,
        coalesce(sum(unknown_result_count), 0)::int AS unknown,
        coalesce(sum(result_not_available_count), 0)::int AS pending,
        CASE
          WHEN coalesce(
            sum(positive_test_count + negative_test_count + inconclusive_test_count),
            0
          ) > 0
            THEN sum(positive_test_count)::float8 * 100.0
              / nullif(sum(positive_test_count + negative_test_count + inconclusive_test_count), 0)
          ELSE 0
        END AS positivity_pct,
        count(DISTINCT coalesce(
          nullif(subject_identifier, ''),
          nullif(case_identifier, '')
        ))::int AS patients_tested,
        round(avg(turnaround_time_hours) / 24.0, 1)::float8 AS avg_tat_days,
        to_char(min(coalesce(reporting_result_date, reporting_collection_date)), 'YYYY-MM-DD') AS first_test,
        to_char(max(coalesce(reporting_result_date, reporting_collection_date)), 'YYYY-MM-DD') AS last_test,
        coalesce(sum(total_test_count) FILTER (
          WHERE event_at > bounds.max_event_at - interval '24 hours'
            AND event_at <= bounds.max_event_at
        ), 0)::int AS tests_24h
      FROM base
      CROSS JOIN bounds
    `,
      [EVD_LAB_TEST_CODE],
    );

    const testsDone = num(row.tests_done);
    return {
      available: testsDone > 0,
      testsDone,
      positive: num(row.positive),
      negative: num(row.negative),
      inconclusive: num(row.inconclusive),
      otherResults: num(row.other),
      pendingResults: num(row.pending),
      unknownResults: num(row.unknown),
      positivityPct: num(row.positivity_pct),
      patientsTested: num(row.patients_tested),
      avgTatDays: nullableNum(row.avg_tat_days),
      firstTest: dateString(row.first_test),
      lastTest: dateString(row.last_test),
      newTested24h: num(row.tests_24h),
    };
  }

  private async labTrend() {
    const rows = await this.many(
      `
      WITH base AS (
        SELECT
          coalesce(
            reporting_result_epi_week_end_date,
            reporting_collection_epi_week_end_date,
            reporting_result_date,
            reporting_collection_date
          ) AS period_end,
          total_test_count,
          positive_test_count,
          negative_test_count
        FROM gold.report_lab_result
        WHERE test_code = $1
      )
      SELECT
        to_char(period_end, 'YYYY-MM-DD') AS date,
        coalesce(sum(total_test_count), 0)::int AS tests,
        coalesce(sum(positive_test_count), 0)::int AS positive,
        coalesce(sum(negative_test_count), 0)::int AS negative
      FROM base
      WHERE period_end IS NOT NULL
      GROUP BY period_end
      ORDER BY period_end
    `,
      [EVD_LAB_TEST_CODE],
    );

    return rows.map((row) => ({
      date: dateString(row.date),
      tests: num(row.tests),
      positive: num(row.positive),
      negative: num(row.negative),
    }));
  }

  private async caseSummary() {
    const row = await this.one(`
      WITH case_base AS (
        SELECT
          *,
          coalesce(investigation_datetime, reporting_date::timestamptz) AS event_at
        FROM gold.report_case_investigation
      ),
      case_bounds AS (
        SELECT max(event_at) AS max_event_at
        FROM case_base
      ),
      outcome_base AS (
        SELECT
          *,
          coalesce(
            outcome_recorded_datetime,
            outcome_date::timestamptz,
            reporting_date::timestamptz
          ) AS event_at
        FROM gold.report_treatment_outcome
      ),
      outcome_bounds AS (
        SELECT max(event_at) AS max_event_at
        FROM outcome_base
      )
      SELECT
        coalesce(sum(total_investigation_count), 0)::int AS total_cases,
        coalesce(sum(final_suspected_count), 0)::int AS suspected,
        coalesce(sum(final_probable_count), 0)::int AS probable,
        coalesce(sum(final_confirmed_count), 0)::int AS confirmed,
        (SELECT coalesce(sum(deceased_count), 0)::int FROM outcome_base) AS deaths,
        (SELECT coalesce(sum(recovered_count), 0)::int FROM outcome_base) AS recoveries,
        count(*) FILTER (
          WHERE nullif(btrim(source_final_laboratory_result), '') IS NOT NULL
        )::int AS tested,
        coalesce(sum(sample_collected_count), 0)::int AS samples_collected,
        count(*) FILTER (
          WHERE nullif(btrim(specimen_identifier), '') IS NOT NULL
        )::int AS with_specimen_id,
        coalesce(sum(total_investigation_count) FILTER (
          WHERE c.event_at > cb.max_event_at - interval '24 hours'
            AND c.event_at <= cb.max_event_at
        ), 0)::int AS cases_24h,
        coalesce(sum(final_confirmed_count) FILTER (
          WHERE c.event_at > cb.max_event_at - interval '24 hours'
            AND c.event_at <= cb.max_event_at
        ), 0)::int AS confirmed_24h,
        (
          SELECT coalesce(sum(deceased_count) FILTER (
            WHERE o.event_at > ob.max_event_at - interval '24 hours'
              AND o.event_at <= ob.max_event_at
          ), 0)::int
          FROM outcome_base o
          CROSS JOIN outcome_bounds ob
        ) AS deaths_24h,
        (
          SELECT coalesce(sum(recovered_count) FILTER (
            WHERE o.event_at > ob.max_event_at - interval '24 hours'
              AND o.event_at <= ob.max_event_at
          ), 0)::int
          FROM outcome_base o
          CROSS JOIN outcome_bounds ob
        ) AS recoveries_24h,
        (SELECT coalesce(sum(total_contact_registration_count), 0)::int
          FROM gold.report_contact_registration) AS contacts_listed,
        to_char(max(cb.max_event_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') AS case_24h_window_end
      FROM case_base c
      CROSS JOIN case_bounds cb
    `);

    const totalCases = num(row.total_cases);
    return {
      available: totalCases > 0,
      totalCases,
      suspected: num(row.suspected),
      confirmed: num(row.confirmed),
      probable: num(row.probable),
      deaths: num(row.deaths),
      recoveries: num(row.recoveries),
      admitted: null,
      newCases24h: num(row.cases_24h),
      newConfirmed24h: num(row.confirmed_24h),
      newAdmissions24h: null,
      newRecoveries24h: num(row.recoveries_24h),
      newDeaths24h: num(row.deaths_24h),
      latestCases: num(row.cases_24h),
      latestCaseDate: dateString(row.case_24h_window_end),
      last24hWindowEnd: stringValue(row.case_24h_window_end),
      contactsListed: num(row.contacts_listed),
      contactsFollowedUp: null,
      importedCases: null,
      localCases: null,
      testedCases: num(row.tested),
      samplesCollected: num(row.samples_collected),
      withSpecimenId: num(row.with_specimen_id),
    };
  }

  private async caseTrend() {
    const rows = await this.many(`
      WITH case_weekly AS (
        SELECT
          reporting_epi_year AS epi_year,
          reporting_epi_week AS epi_week,
          max(reporting_epi_week_label) AS epi_week_label,
          max(reporting_epi_week_end_date) AS period_end,
          coalesce(sum(total_investigation_count), 0)::int AS total_cases,
          coalesce(sum(final_suspected_count), 0)::int AS suspected,
          coalesce(sum(final_confirmed_count), 0)::int AS confirmed
        FROM gold.report_case_investigation
        WHERE reporting_epi_year IS NOT NULL
          AND reporting_epi_week IS NOT NULL
        GROUP BY 1, 2
      ),
      outcome_weekly AS (
        SELECT
          reporting_epi_year AS epi_year,
          reporting_epi_week AS epi_week,
          max(reporting_epi_week_label) AS epi_week_label,
          (
            to_date(
              reporting_epi_year::text || '-' || lpad(reporting_epi_week::text, 2, '0') || '-1',
              'IYYY-IW-ID'
            ) + 5
          )::date AS period_end,
          coalesce(sum(deceased_count), 0)::int AS deaths
        FROM gold.report_treatment_outcome
        WHERE reporting_epi_year IS NOT NULL
          AND reporting_epi_week IS NOT NULL
        GROUP BY 1, 2
      ),
      combined AS (
        SELECT
          epi_year,
          epi_week,
          epi_week_label,
          period_end,
          total_cases,
          suspected,
          confirmed,
          0::int AS deaths
        FROM case_weekly
        UNION ALL
        SELECT epi_year, epi_week, epi_week_label, period_end, 0, 0, 0, deaths
        FROM outcome_weekly
      )
      SELECT
        to_char(max(period_end), 'YYYY-MM-DD') AS date,
        max(epi_week_label) AS epi_week_label,
        coalesce(sum(total_cases), 0)::int AS total_cases,
        coalesce(sum(suspected), 0)::int AS suspected,
        coalesce(sum(confirmed), 0)::int AS confirmed,
        coalesce(sum(deaths), 0)::int AS deaths
      FROM combined
      GROUP BY epi_year, epi_week
      ORDER BY epi_year, epi_week
    `);

    return rows.map((row) => ({
      date: dateString(row.date),
      label: stringValue(row.epi_week_label) ?? dateString(row.date),
      totalCases: num(row.total_cases),
      suspected: num(row.suspected),
      confirmed: num(row.confirmed),
      deaths: num(row.deaths),
    }));
  }

  private async poeSummary() {
    const row = await this.one(`
      WITH base AS (
        SELECT
          *,
          coalesce(screening_datetime, reporting_date::timestamptz) AS event_at
        FROM gold.report_screening
      ),
      bounds AS (
        SELECT max(event_at) AS max_event_at
        FROM base
      )
      SELECT
        coalesce(sum(total_screening_count), 0)::int AS screening_records,
        coalesce(sum(total_screening_count), 0)::int AS total_screened,
        coalesce(sum(flagged_screening_count), 0)::int AS alerts,
        coalesce(sum(suspected_screening_count + probable_screening_count), 0)::int AS suspected,
        0::int AS confirmed,
        0::int AS tested,
        coalesce(sum(total_screening_count) FILTER (
          WHERE event_at > bounds.max_event_at - interval '24 hours'
            AND event_at <= bounds.max_event_at
        ), 0)::int AS screened_24h,
        coalesce(sum(flagged_screening_count) FILTER (
          WHERE event_at > bounds.max_event_at - interval '24 hours'
            AND event_at <= bounds.max_event_at
        ), 0)::int AS alerts_24h,
        to_char(min(reporting_date), 'YYYY-MM-DD') AS first_screening,
        to_char(max(reporting_date), 'YYYY-MM-DD') AS last_screening
      FROM base
      CROSS JOIN bounds
    `);

    const totalScreened = num(row.total_screened);
    return {
      available: totalScreened > 0,
      totalScreened,
      screeningRecords: num(row.screening_records),
      uniqueTravelers: null,
      alerts: num(row.alerts),
      suspected: num(row.suspected),
      confirmed: num(row.confirmed),
      tested: num(row.tested),
      newScreened24h: num(row.screened_24h),
      newAlerts24h: num(row.alerts_24h),
      latestScreened: num(row.screened_24h),
      latestAlerts: num(row.alerts_24h),
      firstScreening: dateString(row.first_screening),
      lastScreening: dateString(row.last_screening),
      note: 'Screening records are available by point of entry; cross-system traveller deduplication is not yet implemented.',
    };
  }

  private async poeRows() {
    const rows = await this.many(`
      SELECT
        coalesce(
          nullif(reporting_point_of_entry, ''),
          nullif(point_of_entry, ''),
          'Not recorded'
        ) AS name,
        coalesce(sum(total_screening_count), 0)::int AS screening_records,
        coalesce(sum(total_screening_count), 0)::int AS screened,
        coalesce(sum(flagged_screening_count), 0)::int AS alerts,
        coalesce(sum(suspected_screening_count + probable_screening_count), 0)::int AS suspected,
        0::int AS confirmed,
        0::int AS tested
      FROM gold.report_screening
      GROUP BY 1
      ORDER BY screened DESC, alerts DESC, name ASC
      LIMIT 20
    `);

    return rows.map((row) => ({
      name: String(row.name),
      screened: num(row.screened),
      screeningRecords: num(row.screening_records),
      uniqueTravelers: null,
      alerts: num(row.alerts),
      suspected: num(row.suspected),
      confirmed: num(row.confirmed),
      tested: num(row.tested),
      unknown: /unknown|not recorded/i.test(String(row.name)),
    }));
  }

  private async geographyRows() {
    const rows = await this.many(`
      WITH geographic_activity AS (
        SELECT
          coalesce(nullif(reporting_county, ''), 'Not recorded') AS county,
          coalesce(sum(total_investigation_count), 0)::int AS total_cases,
          coalesce(sum(final_confirmed_count), 0)::int AS confirmed,
          0::int AS deaths
        FROM gold.report_case_investigation
        GROUP BY 1
        UNION ALL
        SELECT
          coalesce(nullif(reporting_county, ''), 'Not recorded') AS county,
          0,
          0,
          coalesce(sum(deceased_count), 0)::int AS deaths
        FROM gold.report_treatment_outcome
        GROUP BY 1
      )
      SELECT
        county,
        coalesce(sum(total_cases), 0)::int AS total_cases,
        coalesce(sum(confirmed), 0)::int AS confirmed,
        coalesce(sum(deaths), 0)::int AS deaths,
        0::int AS screening_records,
        0::int AS screened,
        0::int AS lab_tests,
        null::float8 AS laboratory_positivity_rate
      FROM geographic_activity
      GROUP BY 1
      ORDER BY total_cases DESC, screened DESC, lab_tests DESC, county ASC
      LIMIT 20
    `);

    return rows.map((row) => ({
      county: String(row.county),
      totalCases: num(row.total_cases),
      confirmed: num(row.confirmed),
      deaths: num(row.deaths),
      screened: num(row.screened),
      screeningRecords: num(row.screening_records),
      labTests: num(row.lab_tests),
      laboratoryPositivityRate: nullableNum(row.laboratory_positivity_rate),
    }));
  }
}
