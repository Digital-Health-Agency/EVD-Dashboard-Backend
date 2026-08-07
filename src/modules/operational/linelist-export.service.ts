import { Inject, Injectable, Logger } from '@nestjs/common';

import { PERIOD_INTERVALS } from '../../common/analytics-helpers.js';
import {
  ANALYTICS_POSTGRES_POOL,
  type Queryable,
} from '../../database/database.module.js';
import {
  CASE_INVESTIGATION_COLUMNS,
  COMMUNITY_SIGNAL_COLUMNS,
  CONTACT_REGISTRATION_COLUMNS,
  LAB_RESULT_COLUMNS,
  SCREENING_COLUMNS,
  TREATMENT_OUTCOME_COLUMNS,
  resolveSort,
  type DatasetRegistry,
  type LinelistColumn,
} from './column-registry.js';
import type { LinelistExportQueryDto } from './dto/linelist-export-query.dto.js';
import {
  buildLinelistScope,
  CASE_INVESTIGATION_FILTERS,
  COMMUNITY_SIGNAL_FILTERS,
  CONTACT_REGISTRATION_FILTERS,
  FACILITY_SCREENING_BASE_FILTERS,
  LAB_RESULT_BASE_FILTERS,
  LAB_RESULT_FILTERS,
  SCREENING_BASE_FILTERS,
  PII_DENIED,
  resolveLinelistProjection,
  SCREENING_FILTERS,
  TREATMENT_OUTCOME_FILTERS,
  type BaseFilters,
  type FilterColumns,
  type LinelistAccess,
  type LinelistRow,
} from './linelist.service.js';

const CURSOR_NAME = 'linelist_export';
const FETCH_SIZE = 500;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface ExportClient extends Queryable {
  release(error?: Error | boolean): void;
}

export interface ExportQueryable extends Queryable {
  connect(): Promise<ExportClient>;
}

export interface LinelistExportWindow {
  from: string;
  to: string;
}

export interface LinelistExportResult {
  columns: LinelistColumn[];
  window: LinelistExportWindow;
  rows: AsyncIterable<LinelistRow>;
  close(): Promise<void>;
}

interface PreparedExport {
  dataset: string;
  registry: DatasetRegistry;
  filters: FilterColumns;
  keyColumn: string;
  fallbackSort: string;
  rowSql: string;
  boundsSql: string;
  boundsParams?: unknown[];
  baseFilters?: BaseFilters;
}

@Injectable()
export class LinelistExportService {
  private readonly logger = new Logger(LinelistExportService.name);

  constructor(
    @Inject(ANALYTICS_POSTGRES_POOL)
    private readonly analyticsDb: ExportQueryable,
  ) {}

  labResults(
    query: LinelistExportQueryDto,
    access: LinelistAccess = PII_DENIED,
  ): Promise<LinelistExportResult> {
    return this.prepare(query, access, {
      dataset: 'lab_result',
      registry: LAB_RESULT_COLUMNS,
      filters: LAB_RESULT_FILTERS,
      keyColumn: 'lab_result_key',
      fallbackSort: 'reporting_result_date',
      baseFilters: LAB_RESULT_BASE_FILTERS,
      boundsParams: ['86518-8'],
      boundsSql: `
        SELECT
          to_char(max(coalesce(
            result_datetime,
            reporting_result_date::timestamptz,
            collection_date::timestamptz
          )) - $2::interval, 'YYYY-MM-DD') AS "from",
          to_char(max(coalesce(
            result_datetime,
            reporting_result_date::timestamptz,
            collection_date::timestamptz
          )), 'YYYY-MM-DD') AS "to"
        FROM gold.report_lab_result
        WHERE test_code = $1`,
      rowSql: `
        WITH base AS (
          SELECT
            __BASE_PROJECTION__,
            coalesce(
              result_datetime,
              reporting_result_date::timestamptz,
              collection_date::timestamptz
            ) AS event_at
          FROM gold.report_lab_result__BASE_WHERE__
        )__BOUNDS_CTE__,
        scoped AS (
          SELECT base.*
          FROM base__CROSS_JOIN__
          WHERE __PREDICATE__
        )
        SELECT __PROJECTION__
        FROM scoped
        ORDER BY __ORDER__`,
    });
  }

  screenings(
    query: LinelistExportQueryDto,
    access: LinelistAccess = PII_DENIED,
  ): Promise<LinelistExportResult> {
    const facilityScope = query.screeningScope === 'facility';
    const baseFilters = facilityScope
      ? FACILITY_SCREENING_BASE_FILTERS
      : SCREENING_BASE_FILTERS;
    const boundsParams = facilityScope
      ? ['TAIFACARE_KENYAEMR']
      : ['TRAVELLER'];
    const boundsColumn = facilityScope ? 'source_system' : 'surveillance_pathway';

    return this.prepare(query, access, {
      dataset: 'screening',
      registry: SCREENING_COLUMNS,
      filters: SCREENING_FILTERS,
      keyColumn: 'screening_key',
      fallbackSort: 'screening_date',
      baseFilters,
      boundsParams,
      boundsSql: `
        SELECT
          to_char(max(coalesce(screening_datetime, reporting_date::timestamptz)) - $2::interval, 'YYYY-MM-DD') AS "from",
          to_char(max(coalesce(screening_datetime, reporting_date::timestamptz)), 'YYYY-MM-DD') AS "to"
        FROM gold.report_screening
        WHERE ${boundsColumn} = $1`,
      rowSql: `
        WITH base AS (
          SELECT
            __BASE_PROJECTION__,
            coalesce(screening_datetime, reporting_date::timestamptz) AS event_at
          FROM gold.report_screening__BASE_WHERE__
        )__BOUNDS_CTE__,
        scoped AS (
          SELECT base.*
          FROM base__CROSS_JOIN__
          WHERE __PREDICATE__
        )
        SELECT __PROJECTION__
        FROM scoped
        ORDER BY __ORDER__`,
    });
  }

  cases(
    query: LinelistExportQueryDto,
    access: LinelistAccess = PII_DENIED,
  ): Promise<LinelistExportResult> {
    return this.prepare(query, access, {
      dataset: 'case_investigation',
      registry: CASE_INVESTIGATION_COLUMNS,
      filters: CASE_INVESTIGATION_FILTERS,
      keyColumn: 'case_investigation_key',
      fallbackSort: 'reporting_date',
      boundsSql: `
        SELECT
          to_char(max(coalesce(investigation_datetime, reporting_date::timestamptz)) - $1::interval, 'YYYY-MM-DD') AS "from",
          to_char(max(coalesce(investigation_datetime, reporting_date::timestamptz)), 'YYYY-MM-DD') AS "to"
        FROM gold.report_case_investigation`,
      rowSql: `
        WITH base AS (
          SELECT
            __BASE_PROJECTION__,
            coalesce(investigation_datetime, reporting_date::timestamptz) AS event_at
          FROM gold.report_case_investigation
        )__BOUNDS_CTE__,
        scoped AS (
          SELECT base.*
          FROM base__CROSS_JOIN__
          WHERE __PREDICATE__
        )
        SELECT __PROJECTION__
        FROM scoped
        ORDER BY __ORDER__`,
    });
  }

  outcomes(
    query: LinelistExportQueryDto,
    access: LinelistAccess = PII_DENIED,
  ): Promise<LinelistExportResult> {
    return this.prepare(query, access, {
      dataset: 'treatment_outcome',
      registry: TREATMENT_OUTCOME_COLUMNS,
      filters: TREATMENT_OUTCOME_FILTERS,
      keyColumn: 'treatment_outcome_key',
      fallbackSort: 'reporting_date',
      boundsSql: `
        SELECT
          to_char(max(coalesce(
            outcome_recorded_datetime,
            outcome_date::timestamptz,
            reporting_date::timestamptz
          )) - $1::interval, 'YYYY-MM-DD') AS "from",
          to_char(max(coalesce(
            outcome_recorded_datetime,
            outcome_date::timestamptz,
            reporting_date::timestamptz
          )), 'YYYY-MM-DD') AS "to"
        FROM gold.report_treatment_outcome`,
      rowSql: `
        WITH base AS (
          SELECT
            __BASE_PROJECTION__,
            coalesce(
              outcome_recorded_datetime,
              outcome_date::timestamptz,
              reporting_date::timestamptz
            ) AS event_at
          FROM gold.report_treatment_outcome
        )__BOUNDS_CTE__,
        scoped AS (
          SELECT base.*
          FROM base__CROSS_JOIN__
          WHERE __PREDICATE__
        )
        SELECT __PROJECTION__
        FROM scoped
        ORDER BY __ORDER__`,
    });
  }

  contacts(
    query: LinelistExportQueryDto,
    access: LinelistAccess = PII_DENIED,
  ): Promise<LinelistExportResult> {
    return this.prepare(query, access, {
      dataset: 'contact_registration',
      registry: CONTACT_REGISTRATION_COLUMNS,
      filters: CONTACT_REGISTRATION_FILTERS,
      keyColumn: 'contact_registration_key',
      fallbackSort: 'registration_date',
      boundsSql: `
        SELECT
          to_char(max(coalesce(registration_datetime, registration_date::timestamptz)) - $1::interval, 'YYYY-MM-DD') AS "from",
          to_char(max(coalesce(registration_datetime, registration_date::timestamptz)), 'YYYY-MM-DD') AS "to"
        FROM gold.report_contact_registration`,
      rowSql: `
        WITH base AS (
          SELECT
            __BASE_PROJECTION__,
            coalesce(registration_datetime, registration_date::timestamptz) AS event_at
          FROM gold.report_contact_registration
        )__BOUNDS_CTE__,
        scoped AS (
          SELECT base.*
          FROM base__CROSS_JOIN__
          WHERE __PREDICATE__
        )
        SELECT __PROJECTION__
        FROM scoped
        ORDER BY __ORDER__`,
    });
  }

  signals(
    query: LinelistExportQueryDto,
    access: LinelistAccess = PII_DENIED,
  ): Promise<LinelistExportResult> {
    return this.prepare(query, access, {
      dataset: 'community_signal',
      registry: COMMUNITY_SIGNAL_COLUMNS,
      filters: COMMUNITY_SIGNAL_FILTERS,
      keyColumn: 'community_signal_key',
      fallbackSort: 'created_date',
      boundsSql: `
        SELECT
          to_char(max(created_date::timestamptz) - $1::interval, 'YYYY-MM-DD') AS "from",
          to_char(max(created_date::timestamptz), 'YYYY-MM-DD') AS "to"
        FROM gold.report_community_signals`,
      rowSql: `
        WITH base AS (
          SELECT
            __BASE_PROJECTION__,
            created_date::timestamptz AS event_at
          FROM gold.report_community_signals
        )__BOUNDS_CTE__,
        scoped AS (
          SELECT base.*
          FROM base__CROSS_JOIN__
          WHERE __PREDICATE__
        )
        SELECT __PROJECTION__
        FROM scoped
        ORDER BY __ORDER__`,
    });
  }

  private async prepare(
    query: LinelistExportQueryDto,
    access: LinelistAccess,
    definition: PreparedExport,
  ): Promise<LinelistExportResult> {
    const columns = resolveLinelistProjection(
      this.logger,
      definition.dataset,
      definition.registry,
      query,
      access,
    );
    const fields = columns.map((column) => column.name);
    const order = resolveSort(
      definition.registry,
      query.sortBy,
      query.sortDir,
      definition.fallbackSort,
    );
    const scope = buildLinelistScope(
      query,
      definition.registry,
      definition.filters,
      fields,
      order,
      definition.keyColumn,
      definition.baseFilters,
    );
    const rowSql = definition.rowSql
      .replace('__BASE_PROJECTION__', scope.baseProjection)
      .replace('__BASE_WHERE__', scope.baseWhere)
      .replace('__BOUNDS_CTE__', scope.boundsCte)
      .replace('__CROSS_JOIN__', scope.crossJoin)
      .replace('__PREDICATE__', scope.predicate)
      .replace('__PROJECTION__', scope.projection)
      .replace('__ORDER__', scope.order);

    const client = await this.analyticsDb.connect();
    let settled = false;
    let released = false;
    const release = (error?: Error) => {
      if (released) return;
      released = true;
      client.release(error);
    };
    const rollback = async () => {
      if (settled) return;
      settled = true;
      await client.query('ROLLBACK').catch(() => undefined);
      release();
    };

    try {
      await client.query(
        'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
      );
      const window = await this.resolveWindow(client, query, definition);
      await client.query(
        `DECLARE ${CURSOR_NAME} NO SCROLL CURSOR FOR ${rowSql}`,
        scope.params,
      );

      const rows = this.cursorRows(client, async () => {
        if (settled) return;
        await client.query('COMMIT');
        settled = true;
        release();
      }, rollback);

      return { columns, window, rows, close: rollback };
    } catch (error) {
      await rollback();
      throw error;
    }
  }

  private async resolveWindow(
    client: ExportClient,
    query: LinelistExportQueryDto,
    definition: PreparedExport,
  ): Promise<LinelistExportWindow> {
    if (query.period === 'custom') {
      if (!query.from || !query.to) {
        throw new Error('Custom export window requires both bounds');
      }
      return {
        from: query.from.slice(0, 10),
        to: query.to.slice(0, 10),
      };
    }

    const interval = PERIOD_INTERVALS[query.period];
    const result = await client.query<{ from: string | null; to: string | null }>(
      definition.boundsSql,
      [...(definition.boundsParams ?? []), interval],
    );
    const window = result.rows[0];
    if (!window || !window.from || !window.to) {
      throw new Error(`Cannot resolve export window for ${definition.dataset}`);
    }
    if (!ISO_DATE.test(window.from) || !ISO_DATE.test(window.to)) {
      throw new Error(`Invalid export window for ${definition.dataset}`);
    }
    return { from: window.from, to: window.to };
  }

  private async *cursorRows(
    client: ExportClient,
    commit: () => Promise<void>,
    rollback: () => Promise<void>,
  ): AsyncGenerator<LinelistRow> {
    let complete = false;
    try {
      while (true) {
        const batch = await client.query<LinelistRow>(
          `FETCH FORWARD ${FETCH_SIZE} FROM ${CURSOR_NAME}`,
        );
        if (batch.rows.length === 0) {
          await commit();
          complete = true;
          return;
        }
        for (const row of batch.rows) yield row;
      }
    } finally {
      if (!complete) await rollback();
    }
  }
}
