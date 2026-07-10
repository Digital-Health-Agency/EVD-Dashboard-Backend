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
  return String(value).slice(0, 10);
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
          cases: source('Source: gold.report_case_summary / gold.report_case_trend'),
          labs: source('Source: gold.report_laboratory_summary'),
          poe: source('Source: gold.report_screening_summary'),
          geography: source('Source: gold.report_geographic_summary'),
          readiness: pending('Awaiting gold readiness indicators'),
          clinical: pending('Awaiting gold admissions/contact follow-up indicators'),
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
    const row = await this.one<{ last_updated: string | null }>(`
      SELECT to_char(
        greatest(
          coalesce((SELECT max(case_date) FROM gold.report_case_summary), date '1970-01-01'),
          coalesce((SELECT max(end_of_week) FROM gold.report_laboratory_summary), date '1970-01-01'),
          coalesce((SELECT max(screening_date) FROM gold.report_screening_summary), date '1970-01-01'),
          coalesce((SELECT max(activity_date) FROM gold.report_geographic_summary), date '1970-01-01')
        ),
        'YYYY-MM-DD'
      ) AS last_updated
    `);
    const lastUpdated = row.last_updated;
    if (!lastUpdated) return new Date().toISOString();
    return `${lastUpdated}T00:00:00.000Z`;
  }

  private async labSummary() {
    const row = await this.one(`
      WITH latest AS (
        SELECT max(end_of_week) AS max_week
        FROM gold.report_laboratory_summary
      )
      SELECT
        coalesce(sum(total_tests), 0)::int AS tests_done,
        coalesce(sum(positive_tests), 0)::int AS positive,
        coalesce(sum(negative_tests), 0)::int AS negative,
        coalesce(sum(inconclusive_tests), 0)::int AS inconclusive,
        coalesce(sum(unknown_tests), 0)::int AS unknown,
        CASE
          WHEN coalesce(sum(total_tests), 0) > 0
            THEN (sum(positive_tests)::float8 * 100.0 / nullif(sum(total_tests), 0))
          ELSE 0
        END AS positivity_pct,
        to_char(min(start_of_week), 'YYYY-MM-DD') AS first_test,
        to_char(max(end_of_week), 'YYYY-MM-DD') AS last_test,
        coalesce(sum(total_tests) FILTER (WHERE end_of_week = (SELECT max_week FROM latest)), 0)::int AS latest_tests
      FROM gold.report_laboratory_summary
    `);

    const testsDone = num(row.tests_done);
    return {
      available: testsDone > 0,
      testsDone,
      positive: num(row.positive),
      negative: num(row.negative),
      inconclusive: num(row.inconclusive),
      pendingResults: null,
      unknownResults: num(row.unknown),
      positivityPct: num(row.positivity_pct),
      patientsTested: testsDone,
      avgTatDays: null,
      firstTest: dateString(row.first_test),
      lastTest: dateString(row.last_test),
      newTested24h: num(row.latest_tests),
    };
  }

  private async labTrend() {
    const rows = await this.many(`
      SELECT
        to_char(end_of_week, 'YYYY-MM-DD') AS date,
        coalesce(sum(total_tests), 0)::int AS tests,
        coalesce(sum(positive_tests), 0)::int AS positive,
        coalesce(sum(negative_tests), 0)::int AS negative
      FROM gold.report_laboratory_summary
      GROUP BY end_of_week
      ORDER BY end_of_week
    `);

    return rows.map((row) => ({
      date: dateString(row.date),
      tests: num(row.tests),
      positive: num(row.positive),
      negative: num(row.negative),
    }));
  }

  private async caseSummary() {
    const row = await this.one(`
      WITH latest AS (
        SELECT max(case_date) AS max_date
        FROM gold.report_case_summary
      )
      SELECT
        coalesce(sum(case_count), 0)::int AS total_cases,
        coalesce(sum(suspected_case_count), 0)::int AS suspected,
        coalesce(sum(probable_case_count), 0)::int AS probable,
        coalesce(sum(confirmed_case_count), 0)::int AS confirmed,
        coalesce(sum(death_count), 0)::int AS deaths,
        coalesce(sum(recovered_case_count), 0)::int AS recoveries,
        coalesce(sum(tested_case_count), 0)::int AS tested,
        coalesce(sum(sample_collected_count), 0)::int AS samples_collected,
        count(*) FILTER (WHERE nullif(specimen_id, '') IS NOT NULL)::int AS with_specimen_id,
        coalesce(sum(case_count) FILTER (WHERE case_date = (SELECT max_date FROM latest)), 0)::int AS latest_cases,
        coalesce(sum(confirmed_case_count) FILTER (WHERE case_date = (SELECT max_date FROM latest)), 0)::int AS latest_confirmed,
        coalesce(sum(death_count) FILTER (WHERE case_date = (SELECT max_date FROM latest)), 0)::int AS latest_deaths,
        coalesce(sum(recovered_case_count) FILTER (WHERE case_date = (SELECT max_date FROM latest)), 0)::int AS latest_recoveries,
        to_char((SELECT max_date FROM latest), 'YYYY-MM-DD') AS latest_case_date
      FROM gold.report_case_summary
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
      newConfirmed24h: num(row.latest_confirmed),
      newAdmissions24h: null,
      newRecoveries24h: num(row.latest_recoveries),
      newDeaths24h: num(row.latest_deaths),
      latestCases: num(row.latest_cases),
      latestCaseDate: dateString(row.latest_case_date),
      contactsListed: null,
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
      SELECT
        to_char(end_of_week, 'YYYY-MM-DD') AS date,
        epi_week_label,
        coalesce(sum(total_cases), 0)::int AS total_cases,
        coalesce(sum(suspected_cases), 0)::int AS suspected,
        coalesce(sum(confirmed_cases), 0)::int AS confirmed,
        coalesce(sum(deaths), 0)::int AS deaths
      FROM gold.report_case_trend
      GROUP BY end_of_week, epi_week_label
      ORDER BY end_of_week
    `);

    return rows.map((row) => ({
      date: dateString(row.date),
      label: row.epi_week_label ? String(row.epi_week_label) : dateString(row.date),
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
          screening_date,
          total_screening_records,
          CASE
            WHEN coalesce(total_screened, 0) > 0 THEN total_screened
            ELSE total_screening_records
          END AS screened_value,
          total_suspected,
          total_confirmed,
          total_tested
        FROM gold.report_screening_summary
      ),
      latest AS (
        SELECT max(screening_date) AS max_date
        FROM base
      )
      SELECT
        coalesce(sum(total_screening_records), 0)::int AS screening_records,
        coalesce(sum(screened_value), 0)::int AS total_screened,
        coalesce(sum(total_suspected), 0)::int AS alerts,
        coalesce(sum(total_confirmed), 0)::int AS confirmed,
        coalesce(sum(total_tested), 0)::int AS tested,
        coalesce(sum(screened_value) FILTER (WHERE screening_date = (SELECT max_date FROM latest)), 0)::int AS latest_screened,
        coalesce(sum(total_suspected) FILTER (WHERE screening_date = (SELECT max_date FROM latest)), 0)::int AS latest_alerts,
        to_char(min(screening_date), 'YYYY-MM-DD') AS first_screening,
        to_char(max(screening_date), 'YYYY-MM-DD') AS last_screening
      FROM base
    `);

    const totalScreened = num(row.total_screened);
    return {
      available: totalScreened > 0,
      totalScreened,
      screeningRecords: num(row.screening_records),
      uniqueTravelers: null,
      alerts: num(row.alerts),
      suspected: num(row.alerts),
      confirmed: num(row.confirmed),
      tested: num(row.tested),
      latestScreened: num(row.latest_screened),
      latestAlerts: num(row.latest_alerts),
      firstScreening: dateString(row.first_screening),
      lastScreening: dateString(row.last_screening),
      note: 'Gold currently provides screening records by point of entry, but not deduplicated traveller counts.',
    };
  }

  private async poeRows() {
    const rows = await this.many(`
      SELECT
        coalesce(nullif(point_of_entry, ''), 'Not recorded') AS name,
        coalesce(sum(total_screening_records), 0)::int AS screening_records,
        coalesce(sum(
          CASE
            WHEN coalesce(total_screened, 0) > 0 THEN total_screened
            ELSE total_screening_records
          END
        ), 0)::int AS screened,
        coalesce(sum(total_suspected), 0)::int AS alerts,
        coalesce(sum(total_confirmed), 0)::int AS confirmed,
        coalesce(sum(total_tested), 0)::int AS tested
      FROM gold.report_screening_summary
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
      suspected: num(row.alerts),
      confirmed: num(row.confirmed),
      tested: num(row.tested),
      unknown: /unknown|not recorded/i.test(String(row.name)),
    }));
  }

  private async geographyRows() {
    const rows = await this.many(`
      SELECT
        coalesce(nullif(county, ''), 'Not recorded') AS county,
        coalesce(sum(total_cases), 0)::int AS total_cases,
        coalesce(sum(confirmed_cases), 0)::int AS confirmed,
        coalesce(sum(deaths), 0)::int AS deaths,
        coalesce(sum(total_screening_records), 0)::int AS screening_records,
        coalesce(sum(
          CASE
            WHEN coalesce(total_screened, 0) > 0 THEN total_screened
            ELSE total_screening_records
          END
        ), 0)::int AS screened,
        coalesce(sum(laboratory_tests), 0)::int AS lab_tests,
        max(laboratory_positivity_rate)::float8 AS laboratory_positivity_rate
      FROM gold.report_geographic_summary
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
