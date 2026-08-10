import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  ANALYTICS_POSTGRES_POOL,
  type Queryable,
} from '../../database/database.module.js';
import { PERIOD_INTERVALS } from '../../common/analytics-helpers.js';
import {
  CASE_INVESTIGATION_COLUMNS,
  COMMUNITY_SIGNAL_COLUMNS,
  CONTACT_REGISTRATION_COLUMNS,
  LAB_RESULT_COLUMNS,
  SCREENING_COLUMNS,
  TREATMENT_OUTCOME_COLUMNS,
  requestedPiiColumns,
  resolveAvailableColumnSpecs,
  resolveColumnSpecs,
  resolveSort,
  searchableColumns,
  type DatasetRegistry,
  type LinelistColumn,
  type ResolvedSort,
} from './column-registry.js';
import {
  AuditService,
  type AuditEventInput,
} from '../audit/audit.service.js';
import type { LinelistQueryDto } from './dto/linelist-query.dto.js';
import type { LinelistExportQueryDto } from './dto/linelist-export-query.dto.js';

export interface LinelistPage<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  columns: LinelistColumn[];
  availableColumns: LinelistColumn[];
}

export type LinelistRow = Record<string, unknown>;

export interface LinelistAccess {
  readonly userId: string | null;
  readonly role: string | null;
  readonly allowPii: boolean;
}

export const PII_DENIED: LinelistAccess = Object.freeze({
  userId: null,
  role: null,
  allowPii: false,
});

const EVD_LAB_TEST_CODE = '86518-8';

export type BaseFilters = ReadonlyArray<
  readonly [column: string, value: unknown]
>;

export const LAB_RESULT_BASE_FILTERS: BaseFilters = Object.freeze([
  ['test_code', EVD_LAB_TEST_CODE],
] as const);

export const SCREENING_BASE_FILTERS: BaseFilters = Object.freeze([
  ['surveillance_pathway', 'TRAVELLER'],
] as const);

export const FACILITY_SCREENING_BASE_FILTERS: BaseFilters = Object.freeze([
  ['source_system', 'TAIFACARE_KENYAEMR'],
] as const);

type FilterKey =
  | 'lab'
  | 'poe'
  | 'facility'
  | 'screeningFlagged'
  | 'signalVerified'
  | 'ageGroup'
  | 'signalStatus'
  | 'signalType'
  | 'communitySource'
  | 'classification'
  | 'initialClassification'
  | 'resultStatus'
  | 'specimenType'
  | 'testName'
  | 'turnaroundBand'
  | 'screeningOutcome'
  | 'screeningCategory'
  | 'treatmentOutcome';

export type FilterColumns = ReadonlyArray<readonly [FilterKey, string]>;

export const LAB_RESULT_FILTERS: FilterColumns = Object.freeze([
  ['lab', 'testing_laboratory_name'],
  ['resultStatus', 'result_category'],
  ['specimenType', 'specimen_type'],
  ['testName', 'test_name'],
  ['turnaroundBand', 'turnaround_time_band'],
] as const);

export const SCREENING_FILTERS: FilterColumns = Object.freeze([
  ['poe', 'reporting_point_of_entry'],
  ['facility', 'reporting_facility_name'],
  ['screeningFlagged', 'flagged_screening_count'],
  ['screeningOutcome', 'screening_outcome'],
  ['screeningCategory', 'reporting_screening_category'],
] as const);

export const CASE_INVESTIGATION_FILTERS: FilterColumns = Object.freeze([
  ['ageGroup', 'reporting_age_group'],
  ['classification', 'final_classification'],
  ['initialClassification', 'initial_classification'],
] as const);

export const TREATMENT_OUTCOME_FILTERS: FilterColumns = Object.freeze([
  ['ageGroup', 'reporting_age_group'],
  ['classification', 'final_classification'],
  ['treatmentOutcome', 'treatment_outcome'],
] as const);

export const CONTACT_REGISTRATION_FILTERS: FilterColumns = Object.freeze([
  ['ageGroup', 'reporting_age_group'],
  ['classification', 'final_classification'],
] as const);

export const COMMUNITY_SIGNAL_FILTERS: FilterColumns = Object.freeze([
  ['communitySource', 'source_system'],
  ['signalVerified', 'signal_verified'],
] as const);

export interface LinelistScope {
  projection: string;
  baseProjection: string;
  baseWhere: string;
  boundsCte: string;
  crossJoin: string;
  predicate: string;
  order: string;
  limitPlaceholder: string;
  offsetPlaceholder: string;
  params: unknown[];
  rowParams: unknown[];
  page: number;
  limit: number;
}

type ProjectionQuery = Pick<LinelistQueryDto, 'fields'>;

export interface LinelistProjectionSink {
  warn(message: string): void;
  recordPiiDenial(event: AuditEventInput): void;
}

export function resolveLinelistProjection(
  sink: LinelistProjectionSink,
  dataset: string,
  registry: DatasetRegistry,
  query: ProjectionQuery,
  access: LinelistAccess,
): LinelistColumn[] {
  const columns = resolveColumnSpecs(registry, query.fields, {
    allowPii: access.allowPii,
  });

  const asked = requestedPiiColumns(registry, query.fields);
  if (asked.length > 0) {
    const who =
      `user=${access.userId ?? 'unknown'}` +
      ` role=${access.role ?? 'unknown'}`;
    const what = `dataset=${dataset} columns=${asked.join(',')}`;
    sink.warn(
      access.allowPii
        ? `pii projection served: ${who} ${what}`
        : `pii projection refused: ${who} ${what}`,
    );
    if (!access.allowPii) {
      sink.recordPiiDenial({
        eventType: 'pii_column_denied',
        actorId: access.userId,
        actorRole: access.role,
        dataset,
        columns: asked,
        filters: {},
        rowCount: null,
        outcome: 'denied',
      });
    }
  }

  return columns;
}

export function projectionSink(
  logger: Pick<Logger, 'warn'>,
  audit: AuditService,
): LinelistProjectionSink {
  return {
    warn: (message) => logger.warn(message),
    recordPiiDenial: (event) => void audit.record(event),
  };
}

@Injectable()
export class LinelistService {
  private readonly logger = new Logger(LinelistService.name);

  private readonly sink: LinelistProjectionSink;

  constructor(
    @Inject(ANALYTICS_POSTGRES_POOL) private readonly analyticsDb: Queryable,
    private readonly audit: AuditService,
  ) {
    this.sink = projectionSink(this.logger, this.audit);
  }

  private projection(
    dataset: string,
    registry: DatasetRegistry,
    query: LinelistQueryDto,
    access: LinelistAccess,
  ): LinelistColumn[] {
    return resolveLinelistProjection(
      this.sink,
      dataset,
      registry,
      query,
      access,
    );
  }

  async labResults(
    query: LinelistQueryDto,
    access: LinelistAccess = PII_DENIED,
  ): Promise<LinelistPage<LinelistRow>> {
    const registry: DatasetRegistry = LAB_RESULT_COLUMNS;
    const columns = this.projection('lab_result', registry, query, access);
    const fields = columns.map((column) => column.name);
    const order = resolveSort(
      registry,
      query.sortBy,
      query.sortDir,
      'reporting_result_date',
    );
    const scope = this.scope(
      query,
      registry,
      LAB_RESULT_FILTERS,
      fields,
      order,
      'lab_result_key',
      LAB_RESULT_BASE_FILTERS,
      access,
    );

    const rowSql = `
      WITH base AS (
        SELECT
          ${scope.baseProjection},
          coalesce(
            result_datetime,
            reporting_result_date::timestamptz,
            collection_date::timestamptz
          ) AS event_at
        FROM gold.report_lab_result${scope.baseWhere}
      )${scope.boundsCte},
      scoped AS (
        SELECT base.*
        FROM base${scope.crossJoin}
        WHERE ${scope.predicate}
      )
      SELECT ${scope.projection}
      FROM scoped
      ORDER BY ${scope.order}
      LIMIT ${scope.limitPlaceholder} OFFSET ${scope.offsetPlaceholder}`;

    const countSql = `
      WITH base AS (
        SELECT
          ${scope.baseProjection},
          coalesce(
            result_datetime,
            reporting_result_date::timestamptz,
            collection_date::timestamptz
          ) AS event_at
        FROM gold.report_lab_result${scope.baseWhere}
      )${scope.boundsCte},
      scoped AS (
        SELECT base.*
        FROM base${scope.crossJoin}
        WHERE ${scope.predicate}
      )
      SELECT count(*)::text AS count
      FROM scoped`;

    return this.read(columns, registry, access, scope, rowSql, countSql);
  }

  async screenings(
    query: LinelistQueryDto,
    access: LinelistAccess = PII_DENIED,
  ): Promise<LinelistPage<LinelistRow>> {
    const registry: DatasetRegistry = SCREENING_COLUMNS;
    const columns = this.projection('screening', registry, query, access);
    const fields = columns.map((column) => column.name);
    const order = resolveSort(
      registry,
      query.sortBy,
      query.sortDir,
      'screening_date',
    );
    const scope = this.scope(
      query,
      registry,
      SCREENING_FILTERS,
      fields,
      order,
      'screening_key',
      query.screeningScope === 'facility'
        ? FACILITY_SCREENING_BASE_FILTERS
        : SCREENING_BASE_FILTERS,
      access,
    );

    const rowSql = `
      WITH base AS (
        SELECT
          ${scope.baseProjection},
          coalesce(screening_datetime, reporting_date::timestamptz) AS event_at
        FROM gold.report_screening${scope.baseWhere}
      )${scope.boundsCte},
      scoped AS (
        SELECT base.*
        FROM base${scope.crossJoin}
        WHERE ${scope.predicate}
      )
      SELECT ${scope.projection}
      FROM scoped
      ORDER BY ${scope.order}
      LIMIT ${scope.limitPlaceholder} OFFSET ${scope.offsetPlaceholder}`;

    const countSql = `
      WITH base AS (
        SELECT
          ${scope.baseProjection},
          coalesce(screening_datetime, reporting_date::timestamptz) AS event_at
        FROM gold.report_screening${scope.baseWhere}
      )${scope.boundsCte},
      scoped AS (
        SELECT base.*
        FROM base${scope.crossJoin}
        WHERE ${scope.predicate}
      )
      SELECT count(*)::text AS count
      FROM scoped`;

    return this.read(columns, registry, access, scope, rowSql, countSql);
  }

  async cases(
    query: LinelistQueryDto,
    access: LinelistAccess = PII_DENIED,
  ): Promise<LinelistPage<LinelistRow>> {
    const registry: DatasetRegistry = CASE_INVESTIGATION_COLUMNS;
    const columns = this.projection(
      'case_investigation',
      registry,
      query,
      access,
    );
    const fields = columns.map((column) => column.name);
    const order = resolveSort(
      registry,
      query.sortBy,
      query.sortDir,
      'reporting_date',
    );
    const scope = this.scope(
      query,
      registry,
      CASE_INVESTIGATION_FILTERS,
      fields,
      order,
      'case_investigation_key',
      [],
      access,
    );

    const rowSql = `
      WITH base AS (
        SELECT
          ${scope.baseProjection},
          coalesce(investigation_datetime, reporting_date::timestamptz) AS event_at
        FROM gold.report_case_investigation
      )${scope.boundsCte},
      scoped AS (
        SELECT base.*
        FROM base${scope.crossJoin}
        WHERE ${scope.predicate}
      )
      SELECT ${scope.projection}
      FROM scoped
      ORDER BY ${scope.order}
      LIMIT ${scope.limitPlaceholder} OFFSET ${scope.offsetPlaceholder}`;

    const countSql = `
      WITH base AS (
        SELECT
          ${scope.baseProjection},
          coalesce(investigation_datetime, reporting_date::timestamptz) AS event_at
        FROM gold.report_case_investigation
      )${scope.boundsCte},
      scoped AS (
        SELECT base.*
        FROM base${scope.crossJoin}
        WHERE ${scope.predicate}
      )
      SELECT count(*)::text AS count
      FROM scoped`;

    return this.read(columns, registry, access, scope, rowSql, countSql);
  }

  async outcomes(
    query: LinelistQueryDto,
    access: LinelistAccess = PII_DENIED,
  ): Promise<LinelistPage<LinelistRow>> {
    const registry: DatasetRegistry = TREATMENT_OUTCOME_COLUMNS;
    const columns = this.projection(
      'treatment_outcome',
      registry,
      query,
      access,
    );
    const fields = columns.map((column) => column.name);
    const order = resolveSort(
      registry,
      query.sortBy,
      query.sortDir,
      'reporting_date',
    );
    const scope = this.scope(
      query,
      registry,
      TREATMENT_OUTCOME_FILTERS,
      fields,
      order,
      'treatment_outcome_key',
      [],
      access,
    );

    const rowSql = `
      WITH base AS (
        SELECT
          ${scope.baseProjection},
          coalesce(
            outcome_recorded_datetime,
            outcome_date::timestamptz,
            reporting_date::timestamptz
          ) AS event_at
        FROM gold.report_treatment_outcome
      )${scope.boundsCte},
      scoped AS (
        SELECT base.*
        FROM base${scope.crossJoin}
        WHERE ${scope.predicate}
      )
      SELECT ${scope.projection}
      FROM scoped
      ORDER BY ${scope.order}
      LIMIT ${scope.limitPlaceholder} OFFSET ${scope.offsetPlaceholder}`;

    const countSql = `
      WITH base AS (
        SELECT
          ${scope.baseProjection},
          coalesce(
            outcome_recorded_datetime,
            outcome_date::timestamptz,
            reporting_date::timestamptz
          ) AS event_at
        FROM gold.report_treatment_outcome
      )${scope.boundsCte},
      scoped AS (
        SELECT base.*
        FROM base${scope.crossJoin}
        WHERE ${scope.predicate}
      )
      SELECT count(*)::text AS count
      FROM scoped`;

    return this.read(columns, registry, access, scope, rowSql, countSql);
  }

  async contacts(
    query: LinelistQueryDto,
    access: LinelistAccess = PII_DENIED,
  ): Promise<LinelistPage<LinelistRow>> {
    const registry: DatasetRegistry = CONTACT_REGISTRATION_COLUMNS;
    const columns = this.projection(
      'contact_registration',
      registry,
      query,
      access,
    );
    const fields = columns.map((column) => column.name);
    const order = resolveSort(
      registry,
      query.sortBy,
      query.sortDir,
      'registration_date',
    );
    const scope = this.scope(
      query,
      registry,
      CONTACT_REGISTRATION_FILTERS,
      fields,
      order,
      'contact_registration_key',
      [],
      access,
    );

    const rowSql = `
      WITH base AS (
        SELECT
          ${scope.baseProjection},
          coalesce(registration_datetime, registration_date::timestamptz) AS event_at
        FROM gold.report_contact_registration
      )${scope.boundsCte},
      scoped AS (
        SELECT base.*
        FROM base${scope.crossJoin}
        WHERE ${scope.predicate}
      )
      SELECT ${scope.projection}
      FROM scoped
      ORDER BY ${scope.order}
      LIMIT ${scope.limitPlaceholder} OFFSET ${scope.offsetPlaceholder}`;

    const countSql = `
      WITH base AS (
        SELECT
          ${scope.baseProjection},
          coalesce(registration_datetime, registration_date::timestamptz) AS event_at
        FROM gold.report_contact_registration
      )${scope.boundsCte},
      scoped AS (
        SELECT base.*
        FROM base${scope.crossJoin}
        WHERE ${scope.predicate}
      )
      SELECT count(*)::text AS count
      FROM scoped`;

    return this.read(columns, registry, access, scope, rowSql, countSql);
  }

  async signals(
    query: LinelistQueryDto,
    access: LinelistAccess = PII_DENIED,
  ): Promise<LinelistPage<LinelistRow>> {
    const registry: DatasetRegistry = COMMUNITY_SIGNAL_COLUMNS;
    const columns = this.projection('community_signal', registry, query, access);
    const fields = columns.map((column) => column.name);
    const order = resolveSort(
      registry,
      query.sortBy,
      query.sortDir,
      'created_date',
    );
    const scope = this.scope(
      query,
      registry,
      COMMUNITY_SIGNAL_FILTERS,
      fields,
      order,
      'community_signal_key',
      [],
      access,
    );

    const rowSql = `
      WITH base AS (
        SELECT
          ${scope.baseProjection},
          created_date::timestamptz AS event_at
        FROM gold.report_community_signals
      )${scope.boundsCte},
      scoped AS (
        SELECT base.*
        FROM base${scope.crossJoin}
        WHERE ${scope.predicate}
      )
      SELECT ${scope.projection}
      FROM scoped
      ORDER BY ${scope.order}
      LIMIT ${scope.limitPlaceholder} OFFSET ${scope.offsetPlaceholder}`;

    const countSql = `
      WITH base AS (
        SELECT
          ${scope.baseProjection},
          created_date::timestamptz AS event_at
        FROM gold.report_community_signals
      )${scope.boundsCte},
      scoped AS (
        SELECT base.*
        FROM base${scope.crossJoin}
        WHERE ${scope.predicate}
      )
      SELECT count(*)::text AS count
      FROM scoped`;

    return this.read(columns, registry, access, scope, rowSql, countSql);
  }

  private async read(
    columns: LinelistColumn[],
    registry: DatasetRegistry,
    access: LinelistAccess,
    scope: LinelistScope,
    rowSql: string,
    countSql: string,
  ): Promise<LinelistPage<LinelistRow>> {
    const [rows, total] = await Promise.all([
      this.analyticsDb.query<LinelistRow>(rowSql, scope.rowParams),
      this.analyticsDb.query<{ count: string }>(countSql, scope.params),
    ]);

    return {
      data: rows.rows,
      total: Number(total.rows[0]?.count ?? 0),
      page: scope.page,
      limit: scope.limit,
      columns,
      availableColumns: resolveAvailableColumnSpecs(registry, {
        allowPii: access.allowPii,
      }),
    };
  }

  private scope(
    query: LinelistQueryDto,
    registry: DatasetRegistry,
    filterColumns: FilterColumns,
    fields: string[],
    order: ResolvedSort,
    keyColumn: string,
    baseFilters: BaseFilters = [],
    access: LinelistAccess = PII_DENIED,
  ): LinelistScope {
    return buildLinelistScope(
      query,
      registry,
      filterColumns,
      fields,
      order,
      keyColumn,
      baseFilters,
      access,
    );
  }
}

export function buildLinelistScope(
  query: LinelistQueryDto | LinelistExportQueryDto,
  registry: DatasetRegistry,
  filterColumns: FilterColumns,
  fields: string[],
  order: ResolvedSort,
  keyColumn: string,
  baseFilters: BaseFilters = [],
  access: LinelistAccess = PII_DENIED,
): LinelistScope {
    const params: unknown[] = [];
    const clauses: string[] = [];
    const anchored = query.period !== 'custom' && query.period !== 'all';

    const baseClauses: string[] = [];
    for (const [column, value] of baseFilters) {
      params.push(value);
      baseClauses.push(`${column} = $${params.length}`);
    }

    if (query.period === 'all') {
      clauses.push('event_at IS NOT NULL');
    } else if (anchored) {
      const interval = PERIOD_INTERVALS[query.period];
      clauses.push(
        `event_at > bounds.max_event_at - interval '${interval}'` +
          ` AND event_at <= bounds.max_event_at`,
      );
    } else {
      params.push(query.from, query.to);
      clauses.push(
        `event_at >= $${params.length - 1}::timestamptz` +
          ` AND event_at <= $${params.length}::timestamptz`,
      );
    }

    for (const [key, column] of filterColumns) {
      const value = query[key];
      if (typeof value !== 'string' || value.length === 0) continue;
      const values =
        key === 'initialClassification'
          ? value
              .split(',')
              .map((part) => part.trim())
              .filter((part) => part.length > 0)
          : [value];
      if (values.length === 0) continue;
      const placeholders = values.map((part) => {
        params.push(part);
        return `lower(btrim($${params.length}))`;
      });
      const predicateColumn =
        key === 'screeningFlagged'
          ? `(${column} > 0)::text`
          : key === 'signalVerified'
            ? `${column}::text`
            : column;
      clauses.push(
        placeholders.length === 1
          ? `lower(btrim(${predicateColumn})) = ${placeholders[0]}`
          : `lower(btrim(${predicateColumn})) IN (${placeholders.join(', ')})`,
      );
    }

    const searchable = searchableColumns(registry, {
      allowPii: access.allowPii,
    });
    if (
      typeof query.q === 'string' &&
      query.q.length > 0 &&
      searchable.length > 0
    ) {
      params.push(`%${query.q}%`);
      const placeholder = `$${params.length}`;
      clauses.push(
        `(${searchable
          .map((column) => `${column} ILIKE ${placeholder}`)
          .join(' OR ')})`,
      );
    }

    const baseColumns = [
      ...new Set([
        ...fields,
        ...baseFilters.map(([column]) => column),
        ...filterColumns.map(([, column]) => column),
        ...searchable,
        order.column,
        keyColumn,
      ]),
    ];

    const hasPaging = 'page' in query && 'limit' in query;
    const limit = hasPaging ? (query.pageSize ?? query.limit) : 0;
    const page = hasPaging ? query.page : 1;
    const offset = hasPaging ? (page - 1) * limit : 0;

    return {
      projection: fields.join(',\n        '),
      baseProjection: baseColumns.join(',\n          '),
      baseWhere:
        baseClauses.length > 0
          ? `\n        WHERE ${baseClauses.join('\n          AND ')}`
          : '',
      boundsCte: anchored
        ? `,\n      bounds AS (\n        SELECT max(event_at) AS max_event_at\n        FROM base\n      )`
        : '',
      crossJoin: anchored ? '\n        CROSS JOIN bounds' : '',
      predicate: clauses.join('\n          AND '),
      order: `${order.column} ${order.direction}, ${keyColumn} ASC`,
      limitPlaceholder: hasPaging ? `$${params.length + 1}` : '',
      offsetPlaceholder: hasPaging ? `$${params.length + 2}` : '',
      params,
      rowParams: hasPaging ? [...params, limit, offset] : params,
      page,
      limit,
    };
}
