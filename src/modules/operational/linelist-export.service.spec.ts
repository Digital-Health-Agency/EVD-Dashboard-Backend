import { describe, expect, it, vi } from 'vitest';

import type { Queryable } from '../../database/database.module.js';
import {
  CASE_INVESTIGATION_COLUMNS,
  COMMUNITY_SIGNAL_COLUMNS,
  CONTACT_REGISTRATION_COLUMNS,
  LAB_RESULT_COLUMNS,
  SCREENING_COLUMNS,
  TREATMENT_OUTCOME_COLUMNS,
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

function exportHarness(fetchBatches: Array<Record<string, unknown>[]> = [[{ probe: 1 }], []]) {
  const calls: Call[] = [];
  let fetchIndex = 0;
  const client = {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      if (/SELECT\s+to_char\(/.test(sql)) {
        return {
          rows: [{ from: '2026-07-07', to: '2026-07-28' }],
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
    ),
    calls,
    client,
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
  return { service: new LinelistService(db), calls };
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
