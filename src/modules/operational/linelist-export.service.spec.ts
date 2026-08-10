import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Queryable } from '../../database/database.module.js';
import {
  CASE_INVESTIGATION_COLUMNS,
  COMMUNITY_SIGNAL_COLUMNS,
  CONTACT_REGISTRATION_COLUMNS,
  LAB_RESULT_COLUMNS,
  SCREENING_COLUMNS,
  TREATMENT_OUTCOME_COLUMNS,
  piiColumns,
  type DatasetRegistry,
} from './column-registry.js';
import { linelistExportQuerySchema } from './dto/linelist-export-query.dto.js';
import { linelistQuerySchema } from './dto/linelist-query.dto.js';
import { LinelistExportService } from './linelist-export.service.js';
import { LinelistService, PII_DENIED } from './linelist.service.js';

interface Call {
  sql: string;
  values?: unknown[];
}

const DATASETS = [
  ['labResults', LAB_RESULT_COLUMNS, 'gold.report_lab_result', 'coalesce(\n            result_datetime,\n            reporting_result_date::timestamptz,\n            collection_date::timestamptz\n          )'],
  ['screenings', SCREENING_COLUMNS, 'gold.report_screening', 'coalesce(screening_datetime, reporting_date::timestamptz)'],
  ['cases', CASE_INVESTIGATION_COLUMNS, 'gold.report_case_investigation', 'coalesce(investigation_datetime, reporting_date::timestamptz)'],
  ['outcomes', TREATMENT_OUTCOME_COLUMNS, 'gold.report_treatment_outcome', 'coalesce(\n            outcome_recorded_datetime,\n            outcome_date::timestamptz,\n            reporting_date::timestamptz\n          )'],
  ['contacts', CONTACT_REGISTRATION_COLUMNS, 'gold.report_contact_registration', 'coalesce(registration_datetime, registration_date::timestamptz)'],
  ['signals', COMMUNITY_SIGNAL_COLUMNS, 'gold.report_community_signals', 'created_date::timestamptz'],
] as const;

function exportHarness(
  fetchBatches: Array<Record<string, unknown>[]> = [[{ probe: 1 }], []],
  audit: { record: ReturnType<typeof vi.fn> } = { record: vi.fn() },
  bounds: { from: string; to: string } = { from: '2026-07-07', to: '2026-07-28' },
) {
  const calls: Call[] = [];
  let fetchIndex = 0;
  const client = {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      if (/SELECT\s+to_char\(/.test(sql)) {
        return {
          rows: [{ ...bounds }],
          rowCount: 1,
        };
      }
      if (/FETCH FORWARD/.test(sql)) {
        const rows = fetchBatches[fetchIndex++] ?? [];
        return { rows, rowCount: rows.length };
      }
      return { rows: [], rowCount: null };
    }),
    release: vi.fn(),
  };
  const db = {
    query: vi.fn(),
    connect: vi.fn().mockResolvedValue(client),
  };

  return {
    service: new LinelistExportService(
      db as unknown as ConstructorParameters<typeof LinelistExportService>[0],
      audit as unknown as ConstructorParameters<typeof LinelistExportService>[1],
    ),
    calls,
    client,
    audit,
  };
}

function readHarness() {
  const calls: Call[] = [];
  const db = {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      return sql.includes('count(*)::text')
        ? { rows: [{ count: '0' }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }),
  } as unknown as Queryable;
  return {
    service: new LinelistService(
      db,
      { record: vi.fn() } as unknown as ConstructorParameters<
        typeof LinelistService
      >[1],
    ),
    calls,
  };
}

function exportSql(calls: Call[]): Call {
  const call = calls.find((entry) => /DECLARE linelist_export/.test(entry.sql));
  expect(call).toBeDefined();
  return call as Call;
}

function readSql(calls: Call[]): Call {
  const call = calls.find((entry) =>
    entry.sql.includes('FROM scoped') && !entry.sql.includes('count(*)::text'),
  );
  expect(call).toBeDefined();
  return call as Call;
}

function compact(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

async function collect(rows: AsyncIterable<Record<string, unknown>>) {
  const collected: Record<string, unknown>[] = [];
  for await (const row of rows) collected.push(row);
  return collected;
}

describe('LinelistExportService parity', () => {
  it.each(DATASETS)(
    '%s uses the same table, event expression, projection and predicates as the read route',
    async (method, registry, table, eventExpression) => {
      const raw = {
        period: 'custom',
        from: '2026-07-01',
        to: '2026-07-28',
        q: 'needle',
        fields: Object.keys(registry).slice(0, 2).join(','),
      };
      const read = readHarness();
      const exported = exportHarness();
      const page = await read.service[method](linelistQuerySchema.parse(raw));
      const result = await exported.service[method](
        linelistExportQuerySchema.parse(raw),
      );
      const screen = readSql(read.calls);
      const file = exportSql(exported.calls);

      expect(file.sql).toContain(`FROM ${table}`);
      expect(screen.sql).toContain(`FROM ${table}`);
      expect(compact(file.sql)).toContain(compact(eventExpression));
      expect(compact(screen.sql)).toContain(compact(eventExpression));
      expect(file.sql).not.toMatch(/\bLIMIT\b|\bOFFSET\b|\bnow\s*\(/i);
      expect(file.values).toEqual(screen.values?.slice(0, -2));
      expect(result.columns).toEqual(page.columns);
      expect(result.columns.map((column) => column.label)).toEqual(
        page.columns.map((column) => column.label),
      );

      await collect(result.rows);
    },
  );

  it.each(DATASETS)(
    '%s omits identifying columns under fail-closed access',
    async (method, registry: DatasetRegistry) => {
      const { service } = exportHarness();
      const result = await service[method](
        linelistExportQuerySchema.parse({}),
        PII_DENIED,
      );

      expect(result.columns.map((column) => column.name)).toEqual(
        Object.values(registry)
          .filter((column) => column.byDefault && column.exposure !== 'pii')
          .map((column) => column.column),
      );
      await collect(result.rows);
    },
  );

  it.each(DATASETS)(
    '%s names no identifying column anywhere in the export statement for a denied caller',
    async (method, registry: DatasetRegistry) => {
      const { service, calls } = exportHarness();
      const result = await service[method](
        linelistExportQuerySchema.parse({ q: 'wanjiku' }),
        PII_DENIED,
      );
      await collect(result.rows);

      const sql = exportSql(calls).sql;
      expect(sql).not.toContain('wanjiku');
      for (const column of piiColumns(registry)) {
        expect(sql, `${method} ${column}`).not.toContain(column);
      }
    },
  );

  it.each(DATASETS)(
    '%s scans the identifying columns in the export statement for an authorised caller',
    async (method, registry: DatasetRegistry) => {
      const { service, calls } = exportHarness();
      const result = await service[method](
        linelistExportQuerySchema.parse({ q: 'wanjiku' }),
        { userId: 'u-1', role: 'surveillance', allowPii: true },
      );
      await collect(result.rows);

      const sql = exportSql(calls).sql;
      for (const column of piiColumns(registry)) {
        expect(sql, `${method} ${column}`).toMatch(
          new RegExp(`\\b${column} ILIKE \\$\\d+`),
        );
      }
    },
  );

  it('returns explicit preset and custom windows', async () => {
    const preset = exportHarness();
    const presetResult = await preset.service.screenings(
      linelistExportQuerySchema.parse({ period: '21d' }),
    );
    expect(presetResult.window).toEqual({
      from: '2026-07-07',
      to: '2026-07-28',
    });
    await collect(presetResult.rows);

    const custom = exportHarness();
    const customResult = await custom.service.screenings(
      linelistExportQuerySchema.parse({
        period: 'custom',
        from: '2026-07-01',
        to: '2026-07-28',
      }),
    );
    expect(customResult.window).toEqual({
      from: '2026-07-01',
      to: '2026-07-28',
    });
    expect(custom.calls.some((call) => /SELECT\s+to_char\(/.test(call.sql))).toBe(false);
    await collect(customResult.rows);
  });

  it('reports a window that starts no earlier than the surveillance cut-off', async () => {
    const preset = exportHarness(undefined, undefined, {
      from: '2020-01-01',
      to: '2026-07-28',
    });
    const presetResult = await preset.service.screenings(
      linelistExportQuerySchema.parse({ period: 'all' }),
    );
    expect(presetResult.window).toEqual({
      from: '2026-05-15',
      to: '2026-07-28',
    });
    await collect(presetResult.rows);

    const custom = exportHarness();
    const customResult = await custom.service.screenings(
      linelistExportQuerySchema.parse({
        period: 'custom',
        from: '2026-05-14',
        to: '2026-07-28',
      }),
    );
    expect(customResult.window).toEqual({
      from: '2026-05-15',
      to: '2026-07-28',
    });
    await collect(customResult.rows);
  });

  it('leaves a measured window that already starts after the cut-off alone', async () => {
    const harness = exportHarness(undefined, undefined, {
      from: '2026-05-16',
      to: '2026-07-28',
    });
    const result = await harness.service.screenings(
      linelistExportQuerySchema.parse({ period: 'all' }),
    );

    expect(result.window.from).toBe('2026-05-16');
    await collect(result.rows);
  });

  it('exports facility alerts from the same TaifaCare base scope', async () => {
    const { service, calls } = exportHarness();
    const result = await service.screenings(
      linelistExportQuerySchema.parse({
        screeningScope: 'facility',
        screeningFlagged: 'true',
        facility: 'Suba Sub County Hospital',
      }),
    );
    await collect(result.rows);

    const bounds = calls.find((call) => /SELECT\s+to_char\(/.test(call.sql));
    expect(bounds?.sql).toContain('WHERE source_system = $1');
    expect(bounds?.values?.[0]).toBe('TAIFACARE_KENYAEMR');

    const row = exportSql(calls);
    expect(row.sql).toContain('source_system = $1');
    expect(row.sql.indexOf('source_system = $1')).toBeLessThan(
      row.sql.indexOf('bounds AS'),
    );
    expect(row.sql).toContain('(flagged_screening_count > 0)::text');
    expect(row.values).toEqual([
      'TAIFACARE_KENYAEMR',
      '2026-05-15',
      'Suba Sub County Hospital',
      'true',
    ]);
  });

  it('fetches a bounded cursor batch at a time and releases the snapshot', async () => {
    const { service, calls, client } = exportHarness([
      [{ id: 1 }, { id: 2 }],
      [{ id: 3 }],
      [],
    ]);
    const result = await service.screenings(linelistExportQuerySchema.parse({}));

    expect(await collect(result.rows)).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(calls.filter((call) => /FETCH FORWARD 500/.test(call.sql))).toHaveLength(3);
    expect(calls.some((call) => /BEGIN.*REPEATABLE READ.*READ ONLY/.test(call.sql))).toBe(true);
    expect(calls.some((call) => call.sql === 'COMMIT')).toBe(true);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('keeps unknown sort text out of the statement', async () => {
    const { service, calls } = exportHarness();
    const result = await service.signals(
      linelistExportQuerySchema.parse({ sortBy: 'password;drop table users' }),
    );
    const sql = exportSql(calls).sql;

    expect(sql).not.toContain('password;drop table users');
    expect(sql).toMatch(/ORDER BY created_date desc, community_signal_key ASC/i);
    await collect(result.rows);
  });

  it('names gold only in all six export statements', async () => {
    for (const [method] of DATASETS) {
      const { service, calls } = exportHarness();
      const result = await service[method](linelistExportQuerySchema.parse({}));
      const sql = exportSql(calls).sql;
      expect(sql).toContain('gold.');
      expect(sql).not.toMatch(/\b(?:bronze|silver|marts)\./);
      await collect(result.rows);
    }
  });
});

describe('LinelistExportService served pii columns', () => {
  const AUTHORISED = {
    userId: 'u-1',
    role: 'surveillance',
    allowPii: true,
  } as const;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function silenceLogger() {
    return vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  }

  it.each(DATASETS)(
    '%s reports the intersection of the served projection with the registry pii set',
    async (method, registry: DatasetRegistry) => {
      silenceLogger();
      const expected = piiColumns(registry);
      const { service } = exportHarness();
      const result = await service[method](
        linelistExportQuerySchema.parse({ fields: expected.join(',') }),
        AUTHORISED,
      );
      await collect(result.rows);

      expect(result.piiColumns).toEqual(expected);
      expect(result.piiColumns.every((name) =>
        result.columns.some((column) => column.name === name),
      )).toBe(true);
    },
  );

  it('reports both identifiers when a screening export selects two of them', async () => {
    silenceLogger();
    const { service } = exportHarness();
    const result = await service.screenings(
      linelistExportQuerySchema.parse({
        fields: 'person_name,person_identifier',
      }),
      AUTHORISED,
    );
    await collect(result.rows);

    expect(result.piiColumns).toHaveLength(2);
  });

  it.each(DATASETS)(
    '%s reports no pii columns for a denied caller',
    async (method, registry: DatasetRegistry) => {
      silenceLogger();
      const { service } = exportHarness();
      const result = await service[method](
        linelistExportQuerySchema.parse({
          fields: piiColumns(registry).join(','),
        }),
        PII_DENIED,
      );
      await collect(result.rows);

      expect(result.piiColumns).toEqual([]);
    },
  );

  it('reports no pii columns when the default projection is served', async () => {
    const { service } = exportHarness();
    const result = await service.screenings(
      linelistExportQuerySchema.parse({}),
      AUTHORISED,
    );
    await collect(result.rows);

    expect(result.piiColumns).toEqual([]);
  });

  it('issues no count query — the statement sequence is unchanged', async () => {
    const { service, calls } = exportHarness([[{ id: 1 }, { id: 2 }], []]);
    const result = await service.screenings(
      linelistExportQuerySchema.parse({ period: '21d' }),
    );
    await collect(result.rows);

    const kindOf = (sql: string) => {
      if (/^BEGIN TRANSACTION/.test(sql.trim())) return 'begin';
      if (/SELECT\s+to_char\(/.test(sql)) return 'bounds';
      if (/^DECLARE linelist_export/.test(sql.trim())) return 'declare';
      if (/^FETCH FORWARD/.test(sql.trim())) return 'fetch';
      if (sql.trim() === 'COMMIT') return 'commit';
      return `other:${sql.trim().slice(0, 40)}`;
    };

    expect(calls.map((call) => kindOf(call.sql))).toEqual([
      'begin',
      'bounds',
      'declare',
      'fetch',
      'fetch',
      'commit',
    ]);
    for (const call of calls) {
      expect(call.sql).not.toMatch(/count\s*\(\s*\*\s*\)/i);
    }
  });
});

describe('LinelistExportService pii denial audit', () => {
  const DENIED = { userId: 'u-9', role: 'user', allowPii: false } as const;
  const AUTHORISED = {
    userId: 'u-1',
    role: 'surveillance',
    allowPii: true,
  } as const;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function silenceLogger() {
    return vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  }

  it.each(DATASETS)(
    '%s emits the same denial event on the export path as the paged path',
    async (method, registry: DatasetRegistry) => {
      silenceLogger();
      const column = piiColumns(registry)[0];
      const { service, audit } = exportHarness();
      const result = await service[method](
        linelistExportQuerySchema.parse({ fields: column }),
        DENIED,
      );
      await collect(result.rows);

      expect(audit.record).toHaveBeenCalledTimes(1);
      const event = audit.record.mock.calls[0][0] as Record<string, unknown>;
      expect(event.eventType).toBe('pii_column_denied');
      expect(event.actorId).toBe(DENIED.userId);
      expect(event.actorRole).toBe(DENIED.role);
      expect(event.columns).toEqual([column]);
      expect(event.outcome).toBe('denied');
      expect(event.rowCount).toBeNull();
    },
  );

  it.each(DATASETS)(
    '%s emits no denial event for an authorised caller',
    async (method, registry: DatasetRegistry) => {
      silenceLogger();
      const { service, audit } = exportHarness();
      const result = await service[method](
        linelistExportQuerySchema.parse({
          fields: piiColumns(registry).join(','),
        }),
        AUTHORISED,
      );
      await collect(result.rows);

      expect(audit.record).not.toHaveBeenCalled();
    },
  );
});
