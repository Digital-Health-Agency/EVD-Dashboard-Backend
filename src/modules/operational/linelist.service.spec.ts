import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Queryable } from '../../database/database.module.js';
import { formatFor, type ColumnFormat } from './column-labels.js';
import {
  CASE_INVESTIGATION_COLUMNS,
  COMMUNITY_SIGNAL_COLUMNS,
  CONTACT_REGISTRATION_COLUMNS,
  LAB_RESULT_COLUMNS,
  SCREENING_COLUMNS,
  TREATMENT_OUTCOME_COLUMNS,
  piiColumns,
  resolveFields,
  searchableColumns,
} from './column-registry.js';
import { linelistQuerySchema } from './dto/linelist-query.dto.js';
import { LinelistService } from './linelist.service.js';

const TOTAL_FROM_COUNT_QUERY = 4242;

const SURVEILLANCE_START = '2026-05-15';

interface Call {
  sql: string;
  values?: unknown[];
}

function harness(audit: { record: ReturnType<typeof vi.fn> } = { record: vi.fn() }) {
  const calls: Call[] = [];
  const db = {
    query: vi.fn((sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      if (sql.includes('count(*)::text')) {
        return Promise.resolve({
          rows: [{ count: String(TOTAL_FROM_COUNT_QUERY) }],
          rowCount: 1,
        });
      }
      return Promise.resolve({ rows: [{ probe_row: 1 }], rowCount: 1 });
    }),
  } as unknown as Queryable;

  return {
    service: new LinelistService(
      db,
      audit as unknown as ConstructorParameters<typeof LinelistService>[1],
    ),
    calls,
    audit,
  };
}

function parse(raw: Record<string, unknown> = {}) {
  return linelistQuerySchema.parse(raw);
}

function rowStatement(calls: Call[]): Call {
  const call = calls.find((entry) => !entry.sql.includes('count(*)::text'));
  expect(call).toBeDefined();
  return call as Call;
}

function countStatement(calls: Call[]): Call {
  const call = calls.find((entry) => entry.sql.includes('count(*)::text'));
  expect(call).toBeDefined();
  return call as Call;
}

function orderByClauseOf(sql: string): string {
  const match = /\n\s+ORDER BY ([^\n]+)/.exec(sql);
  expect(match).not.toBeNull();
  return (match as RegExpExecArray)[1];
}

function projectionOf(sql: string): string[] {
  const match = /\n {6}SELECT ([\s\S]*?)\n {6}FROM scoped/.exec(sql);
  expect(match).not.toBeNull();
  return (match as RegExpExecArray)[1].split(',').map((name) => name.trim());
}

function baseProjectionOf(sql: string): string[] {
  const match = /WITH base AS \(\n\s+SELECT\n([\s\S]*?)\n\s+FROM gold/.exec(sql);
  expect(match).not.toBeNull();
  return (match as RegExpExecArray)[1].split(',').map((name) => name.trim());
}

const DATASETS = [
  ['labResults', LAB_RESULT_COLUMNS],
  ['screenings', SCREENING_COLUMNS],
  ['cases', CASE_INVESTIGATION_COLUMNS],
  ['outcomes', TREATMENT_OUTCOME_COLUMNS],
  ['contacts', CONTACT_REGISTRATION_COLUMNS],
  ['signals', COMMUNITY_SIGNAL_COLUMNS],
] as const;

const DENIED = { userId: 'u-9', role: 'user', allowPii: false } as const;
const AUTHORISED = {
  userId: 'u-1',
  role: 'surveillance',
  allowPii: true,
} as const;

describe('LinelistService projection', () => {
  it.each([
    ['labResults', LAB_RESULT_COLUMNS],
    ['screenings', SCREENING_COLUMNS],
    ['cases', CASE_INVESTIGATION_COLUMNS],
    ['outcomes', TREATMENT_OUTCOME_COLUMNS],
    ['contacts', CONTACT_REGISTRATION_COLUMNS],
    ['signals', COMMUNITY_SIGNAL_COLUMNS],
  ] as const)('%s returns ordered column metadata beside the page', async (method, registry) => {
    const { service } = harness();
    const page = await service[method](parse());
    const fields = resolveFields(registry);
    type DisplayColumn = {
      name: string;
      label: string;
      sortable: boolean;
      format: ColumnFormat;
    };
    const columns = (page as typeof page & {
      columns?: DisplayColumn[];
    }).columns;
    const availableColumns = (page as typeof page & {
      availableColumns?: DisplayColumn[];
    }).availableColumns;

    expect(columns).toHaveLength(fields.length);
    expect(columns?.map((column) => column.name)).toEqual(fields);
    for (const column of columns ?? []) {
      expect(column).toEqual({
        name: column.name,
        label: expect.any(String),
        sortable: registry[column.name].sortable,
        format: formatFor(column.name),
      });
    }
    expect(availableColumns?.map((column) => column.name)).toEqual(
      Object.values(registry)
        .filter((spec) => spec.exposure !== 'pii')
        .map((spec) => spec.column),
    );
    expect(page).toEqual(expect.objectContaining({
      data: expect.any(Array),
      total: expect.any(Number),
      page: expect.any(Number),
      limit: expect.any(Number),
    }));
  });

  it('keeps columns as the requested projection while availableColumns exposes the authorised registry', async () => {
    const { service, calls } = harness();
    const requested = ['signal_verified'];
    const page = await service.signals(parse({ fields: requested.join(',') }), {
      userId: 'u-1',
      role: 'viewer',
      allowPii: true,
    });

    expect(page.columns.map((column) => column.name)).toEqual(requested);
    expect(projectionOf(rowStatement(calls).sql)).toEqual(requested);
    expect(
      (page as typeof page & { availableColumns?: Array<{ name: string }> })
        .availableColumns?.map((column) => column.name),
    ).toEqual(Object.keys(COMMUNITY_SIGNAL_COLUMNS));
  });

  it('pre-selects no identifying column for community signals even for an authorised caller', async () => {
    const { service, calls } = harness();
    const page = await service.signals(parse(), AUTHORISED);

    const sql = rowStatement(calls).sql;
    const projection = projectionOf(sql);
    expect(projection).toEqual(
      resolveFields(COMMUNITY_SIGNAL_COLUMNS, undefined, { allowPii: true }),
    );

    for (const column of piiColumns(COMMUNITY_SIGNAL_COLUMNS)) {
      expect(projection).not.toContain(column);
      expect(page.availableColumns.map((entry) => entry.name)).toContain(column);
    }
  });

  it('pre-selects no identifying column for screenings even for an authorised caller', async () => {
    const { service, calls } = harness();
    const page = await service.screenings(parse(), AUTHORISED);

    const sql = rowStatement(calls).sql;
    const projection = projectionOf(sql);
    expect(projection).toEqual(
      resolveFields(SCREENING_COLUMNS, undefined, { allowPii: true }),
    );

    for (const column of piiColumns(SCREENING_COLUMNS)) {
      expect(projection).not.toContain(column);
      expect(page.availableColumns.map((entry) => entry.name)).toContain(column);
    }
  });

  it('includes an identifying column when an AUTHORISED caller names it', async () => {
    const { service, calls } = harness();
    await service.signals(parse({ fields: 'signal_description' }), {
      userId: 'u-1',
      role: 'admin',
      allowPii: true,
    });

    const projection = projectionOf(rowStatement(calls).sql);
    expect(projection).toEqual(['signal_description']);
  });

  it('drops an unknown field name and returns exactly the default projection', async () => {
    const { service, calls } = harness();
    await service.signals(
      parse({ fields: 'no_such_column,(select 1),password' }),
    );

    expect(projectionOf(rowStatement(calls).sql)).toEqual(
      resolveFields(COMMUNITY_SIGNAL_COLUMNS),
    );
  });
});

describe('LinelistService pii access', () => {
  const PII_FIELDS = 'signal_description';

  function loggerSpy() {
    return vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('omits an identifying column for a caller with no pii access', async () => {
    const { service, calls } = harness();
    await service.signals(parse({ fields: PII_FIELDS }), {
      userId: 'u-2',
      role: 'user',
      allowPii: false,
    });

    const projection = projectionOf(rowStatement(calls).sql);
    expect(projection).toEqual(resolveFields(COMMUNITY_SIGNAL_COLUMNS));
    for (const column of piiColumns(COMMUNITY_SIGNAL_COLUMNS)) {
      expect(projection).not.toContain(column);
    }
  });

  it('omits an identifying column when no access is supplied at all', async () => {
    const { service, calls } = harness();
    await service.signals(parse({ fields: PII_FIELDS }));

    expect(projectionOf(rowStatement(calls).sql)).toEqual(
      resolveFields(COMMUNITY_SIGNAL_COLUMNS),
    );
  });

  it('logs the principal, the dataset and the columns when pii is served', async () => {
    const warn = loggerSpy();
    const { service } = harness();
    await service.signals(parse({ fields: PII_FIELDS }), {
      userId: 'u-1',
      role: 'admin',
      allowPii: true,
    });

    expect(warn).toHaveBeenCalledTimes(1);
    const entry = String(warn.mock.calls[0][0]);
    expect(entry).toContain('pii projection served');
    expect(entry).toContain('user=u-1');
    expect(entry).toContain('role=admin');
    expect(entry).toContain('dataset=community_signal');
    expect(entry).toContain('signal_description');
  });

  it('logs a refusal as well as a grant', async () => {
    const warn = loggerSpy();
    const { service } = harness();
    await service.signals(parse({ fields: PII_FIELDS }), {
      userId: 'u-2',
      role: 'user',
      allowPii: false,
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('pii projection refused');
  });

  it('writes no access entry for a request that names no pii column', async () => {
    const warn = loggerSpy();
    const { service } = harness();
    await service.signals(parse({ fields: 'signal_verified' }), {
      userId: 'u-1',
      role: 'admin',
      allowPii: true,
    });

    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['labResults', 'subject_identifier', 'lab_result'],
    ['screenings', 'person_name', 'screening'],
    ['cases', 'source_person_identifier', 'case_investigation'],
    ['outcomes', 'source_person_name', 'treatment_outcome'],
    ['contacts', 'source_contact_identifier', 'contact_registration'],
    ['signals', 'signal_description', 'community_signal'],
  ] as const)('warns for an explicit %s identifying request', async (method, column, dataset) => {
    const warn = loggerSpy();
    const { service } = harness();
    await service[method](parse({ fields: column }), {
      userId: 'u-1',
      role: 'admin',
      allowPii: true,
    });

    expect(warn).toHaveBeenCalledTimes(1);
    const entry = String(warn.mock.calls[0][0]);
    expect(entry).toContain(`dataset=${dataset}`);
    expect(entry).toContain(`columns=${column}`);
  });
});

describe('LinelistService pii denial audit', () => {
  const PII_DATASETS = [
    ['labResults', 'subject_identifier', 'lab_result'],
    ['screenings', 'person_name', 'screening'],
    ['cases', 'source_person_identifier', 'case_investigation'],
    ['outcomes', 'source_person_name', 'treatment_outcome'],
    ['contacts', 'source_contact_identifier', 'contact_registration'],
    ['signals', 'signal_description', 'community_signal'],
  ] as const;

  function silenceLogger() {
    return vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe.each(PII_DATASETS)(
    '%s',
    (method, column, dataset) => {
      it('records exactly one pii_column_denied event for a refused caller', async () => {
        silenceLogger();
        const { service, audit } = harness();
        await service[method](parse({ fields: column }), DENIED);

        expect(audit.record).toHaveBeenCalledTimes(1);
        expect(audit.record).toHaveBeenCalledWith({
          eventType: 'pii_column_denied',
          actorId: DENIED.userId,
          actorRole: DENIED.role,
          dataset,
          columns: [column],
          filters: {},
          rowCount: null,
          outcome: 'denied',
        });
      });

      it('records nothing for an authorised caller naming the same column', async () => {
        silenceLogger();
        const { service, audit } = harness();
        await service[method](parse({ fields: column }), AUTHORISED);

        expect(audit.record).not.toHaveBeenCalled();
      });

      it('still serves a usable projection to the refused caller', async () => {
        silenceLogger();
        const { service } = harness();
        const page = await service[method](parse({ fields: column }), DENIED);

        expect(page.columns.length).toBeGreaterThan(0);
        expect(page.availableColumns.length).toBeGreaterThan(0);
        expect(page.columns.map((entry) => entry.name)).not.toContain(column);
      });
    },
  );

  it('records nothing when the request names only non-identifying columns', async () => {
    silenceLogger();
    const { service, audit } = harness();
    await service.signals(parse({ fields: 'signal_verified' }), DENIED);

    expect(audit.record).not.toHaveBeenCalled();
  });

  it('records nothing when the request names no columns at all', async () => {
    silenceLogger();
    const { service, audit } = harness();
    await service.signals(parse(), DENIED);

    expect(audit.record).not.toHaveBeenCalled();
  });

  it('emits the existing refusal warning alongside the audit record', async () => {
    const warn = silenceLogger();
    const { service, audit } = harness();
    await service.signals(parse({ fields: 'signal_description' }), DENIED);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('pii projection refused');
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it('never carries an unknown or prototype-polluting field name into the audit row', async () => {
    silenceLogger();
    const { service, audit } = harness();
    await service.signals(
      parse({
        fields: '__proto__,constructor,no_such_column,*,signal_description',
      }),
      DENIED,
    );

    expect(audit.record).toHaveBeenCalledTimes(1);
    const event = audit.record.mock.calls[0][0] as { columns: string[] };
    expect(event.columns).toEqual(['signal_description']);
  });

  it('resolves the request normally when the audit write rejects', async () => {
    silenceLogger();
    const rejection = Promise.reject(new Error('audit sink unavailable'));
    rejection.catch(() => undefined);
    const { service, audit } = harness({
      record: vi.fn(() => rejection),
    });

    const page = await service.signals(
      parse({ fields: 'signal_description' }),
      DENIED,
    );

    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(page.columns.length).toBeGreaterThan(0);
    expect(page.total).toBe(TOTAL_FROM_COUNT_QUERY);
  });
});

describe('LinelistService paging', () => {
  it('binds limit and offset as parameters computed from page and limit', async () => {
    const { service, calls } = harness();
    const page = await service.signals(parse({ page: '3', limit: '25' }));

    const row = rowStatement(calls);
    expect(row.sql).toContain('LIMIT $2 OFFSET $3');
    expect(row.values).toEqual([SURVEILLANCE_START, 25, 50]);
    expect(page.page).toBe(3);
    expect(page.limit).toBe(25);
  });

  it('takes the total from the count statement, which carries no limit or offset', async () => {
    const { service, calls } = harness();
    const page = await service.signals(parse());

    expect(page.total).toBe(TOTAL_FROM_COUNT_QUERY);

    const count = countStatement(calls);
    expect(count.sql).not.toContain('LIMIT');
    expect(count.sql).not.toContain('OFFSET');
    expect(count.values).toEqual([SURVEILLANCE_START]);
  });

  it('lets pageSize override limit', async () => {
    const { service, calls } = harness();
    const page = await service.signals(
      parse({ page: '2', limit: '50', pageSize: '10' }),
    );

    expect(page.limit).toBe(10);
    expect(rowStatement(calls).values).toEqual([SURVEILLANCE_START, 10, 10]);
  });
});

describe('LinelistService ordering', () => {
  it('falls back to the dataset default when sortBy is hostile, and never emits the text', async () => {
    const injection = 'id; DROP TABLE gold.report_community_signals';
    const { service, calls } = harness();
    await service.signals(parse({ sortBy: injection, sortDir: 'asc' }));

    expect(rowStatement(calls).sql).toContain(
      'ORDER BY created_date DESC, community_signal_key ASC',
    );
    for (const call of calls) {
      expect(call.sql).not.toContain(injection);
      expect(call.sql).not.toContain('DROP TABLE');
    }
  });

  it('honours a sortable registry column in either direction', async () => {
    const { service, calls } = harness();
    await service.signals(parse({ sortBy: 'signal_verified', sortDir: 'asc' }));

    expect(rowStatement(calls).sql).toContain(
      'ORDER BY signal_verified ASC, community_signal_key ASC',
    );
  });

  it('refuses to order on an identifying column', async () => {
    const { service, calls } = harness();
    await service.signals(
      parse({
        sortBy: 'signal_description',
        sortDir: 'asc',
        fields: 'signal_description',
      }),
      { userId: 'u-1', role: 'surveillance', allowPii: true },
    );

    const sql = rowStatement(calls).sql;
    expect(projectionOf(sql)).toContain('signal_description');
    const orderBy = orderByClauseOf(sql);
    expect(orderBy).toBe('created_date DESC, community_signal_key ASC');
    expect(orderBy).not.toContain('signal_description');
  });
});

describe('LinelistService search', () => {
  it('binds the pattern and scans only searchable registry identifiers', async () => {
    const { service, calls } = harness();
    await service.signals(parse({ q: 'nairobi' }));

    const row = rowStatement(calls);
    const searchable = searchableColumns(COMMUNITY_SIGNAL_COLUMNS);
    const disjunction = searchable
      .map((column) => `${column} ILIKE $2`)
      .join(' OR ');

    expect(searchable).toEqual(['county', 'subcounty', 'community_unit']);
    expect(row.sql).toContain(`(${disjunction})`);
    expect(row.values).toEqual([SURVEILLANCE_START, '%nairobi%', 50, 0]);
    expect(row.sql).not.toContain('nairobi');
    expect(countStatement(calls).values).toEqual([
      SURVEILLANCE_START,
      '%nairobi%',
    ]);
  });

  it('scans no identifying column for a caller the registry denies them to', async () => {
    const { service, calls } = harness();
    await service.signals(parse({ q: 'anything' }), DENIED);

    const sql = rowStatement(calls).sql;
    for (const column of piiColumns(COMMUNITY_SIGNAL_COLUMNS)) {
      expect(sql).not.toContain(column);
    }
  });

  it('scans identifying columns for an authorised caller', async () => {
    const { service, calls } = harness();
    await service.signals(parse({ q: 'anything' }), AUTHORISED);

    const sql = rowStatement(calls).sql;
    for (const column of piiColumns(COMMUNITY_SIGNAL_COLUMNS)) {
      expect(sql).toContain(`${column} ILIKE $2`);
    }
  });

  it('binds one pattern and reuses one placeholder across every scanned column', async () => {
    const { service, calls } = harness();
    await service.signals(parse({ q: 'anything' }));

    const row = rowStatement(calls);
    const placeholders = [
      ...row.sql.matchAll(/\bILIKE \$(\d+)/g),
    ].map((match) => match[1]);

    expect(placeholders).toHaveLength(
      searchableColumns(COMMUNITY_SIGNAL_COLUMNS).length,
    );
    expect(new Set(placeholders)).toEqual(new Set(['2']));
    expect(row.values?.filter((value) => value === '%anything%')).toHaveLength(1);
  });
});

describe.each(DATASETS)(
  '%s SQL under a denied caller',
  (method, registry) => {
    it('names no identifying column in the row statement, with or without a search term', async () => {
      for (const raw of [{ q: 'wanjiku' }, {}]) {
        const { service, calls } = harness();
        await service[method](parse(raw), DENIED);

        const sql = rowStatement(calls).sql;
        for (const column of piiColumns(registry)) {
          expect(sql, `${method} ${column}`).not.toContain(column);
        }
      }
    });

    it('names no identifying column in the count statement either', async () => {
      for (const raw of [{ q: 'wanjiku' }, {}]) {
        const { service, calls } = harness();
        await service[method](parse(raw), DENIED);

        const sql = countStatement(calls).sql;
        for (const column of piiColumns(registry)) {
          expect(sql, `${method} ${column}`).not.toContain(column);
        }
      }
    });

    it('still binds the pattern positionally and still serves a usable projection', async () => {
      const { service, calls } = harness();
      const page = await service[method](parse({ q: 'wanjiku' }), DENIED);

      const row = rowStatement(calls);
      expect(row.sql).not.toContain('wanjiku');
      expect(row.sql).toMatch(/ILIKE \$\d+/);
      expect(row.values).toContain('%wanjiku%');
      expect(countStatement(calls).values).toContain('%wanjiku%');

      const projection = projectionOf(row.sql);
      expect(projection.length).toBeGreaterThan(0);
      expect(projection).toEqual(resolveFields(registry));
      expect(page.columns.length).toBeGreaterThan(0);
    });
  },
);

describe.each(DATASETS)(
  '%s SQL under an authorised caller',
  (method, registry) => {
    it('scans every identifying column in the search disjunction', async () => {
      const { service, calls } = harness();
      await service[method](parse({ q: 'wanjiku' }), AUTHORISED);

      const sql = rowStatement(calls).sql;
      for (const column of piiColumns(registry)) {
        expect(sql, `${method} ${column}`).toMatch(
          new RegExp(`\\b${column} ILIKE \\$\\d+`),
        );
      }
    });

    it('projects an identifying column in the base CTE once it is selected', async () => {
      for (const column of piiColumns(registry)) {
        const { service, calls } = harness();
        await service[method](parse({ fields: column }), AUTHORISED);

        const sql = rowStatement(calls).sql;
        expect(projectionOf(sql), `${method} ${column}`).toEqual([column]);
        expect(baseProjectionOf(sql), `${method} ${column}`).toContain(column);
      }
    });
  },
);

describe('LinelistService window resolution', () => {
  it('anchors a preset to the table max and issues a bounds sub-select', async () => {
    const { service, calls } = harness();
    await service.signals(parse({ period: '7d' }));

    const row = rowStatement(calls);
    expect(row.sql).toContain('bounds AS (');
    expect(row.sql).toContain('max(event_at) AS max_event_at');
    expect(row.sql).toContain(
      "event_at > bounds.max_event_at - interval '7 days' AND event_at >= $1::timestamptz",
    );
    expect(row.sql).not.toContain('now()');
    expect(row.values).toEqual([SURVEILLANCE_START, 50, 0]);
  });

  it('never lets an anchored window start before the surveillance cut-off', async () => {
    for (const period of ['24h', '7d', '21d', '42d'] as const) {
      const { service, calls } = harness();
      await service.signals(parse({ period }));

      const row = rowStatement(calls);
      expect(row.sql, period).toMatch(
        /event_at > bounds\.max_event_at - interval '[^']+' AND event_at >= \$1::timestamptz/,
      );
      expect(row.values?.[0], period).toBe(SURVEILLANCE_START);
      expect(row.sql, period).not.toContain('greatest(');
      expect(row.sql, period).not.toContain('now()');
    }
  });

  it('bounds the all-time period at the surveillance start rather than leaving it open', async () => {
    const { service, calls } = harness();
    await service.signals(parse({ period: 'all' }));

    const row = rowStatement(calls);
    expect(row.sql).not.toContain('bounds AS (');
    expect(row.sql).not.toContain('CROSS JOIN bounds');
    expect(row.sql).not.toContain('interval');
    expect(row.sql).not.toContain('undefined');
    expect(row.sql).not.toContain('event_at IS NOT NULL');
    expect(row.sql).toContain('event_at >= $1::timestamptz');
    expect(row.values).toEqual([SURVEILLANCE_START, 50, 0]);
  });

  it('applies a custom range as two bound timestamps with no bounds sub-select', async () => {
    const { service, calls } = harness();
    await service.signals(
      parse({ period: 'custom', from: '2026-07-01', to: '2026-07-28' }),
    );

    const row = rowStatement(calls);
    expect(row.sql).not.toContain('bounds AS (');
    expect(row.sql).not.toContain('CROSS JOIN bounds');
    expect(row.sql).toContain('event_at >= $1::timestamptz');
    expect(row.sql).toContain('event_at <= $2::timestamptz');
    expect(row.values).toEqual([
      '2026-07-01 00:00:00',
      '2026-07-28 23:59:59.999',
      50,
      0,
    ]);
  });

  it('clamps a custom range that reaches back before the cut-off', async () => {
    const { service, calls } = harness();
    await service.signals(
      parse({ period: 'custom', from: '2026-05-14', to: '2026-07-28' }),
    );

    const row = rowStatement(calls);
    expect(row.values?.[0]).toBe('2026-05-15 00:00:00');
    expect(row.values?.[1]).toBe('2026-07-28 23:59:59.999');
    expect(row.values).not.toContain('2026-05-14 00:00:00');
  });

  it('leaves a custom range that already starts after the cut-off alone', async () => {
    const { service, calls } = harness();
    await service.signals(
      parse({ period: 'custom', from: '2026-05-16', to: '2026-07-28' }),
    );

    expect(rowStatement(calls).values?.[0]).toBe('2026-05-16 00:00:00');
  });
});

describe('LinelistService filters', () => {
  it('binds a value filter against the mart column, normalised on both sides', async () => {
    const { service, calls } = harness();
    await service.signals(
      parse({ signalStatus: 'VERIFIED', communitySource: 'ECHIS' }),
    );

    const row = rowStatement(calls);
    expect(row.sql).not.toContain('signal_status');
    expect(row.sql).toContain('lower(btrim(source_system)) = lower(btrim($2))');
    expect(row.sql).not.toContain('ECHIS');
    expect(row.values).toEqual([SURVEILLANCE_START, 'ECHIS', 50, 0]);
  });

  it('ignores a filter the dataset has no column for rather than raising', async () => {
    const { service, calls } = harness();
    const page = await service.signals(
      parse({ specimenType: 'BLOOD', poe: 'JKIA' }),
    );

    const row = rowStatement(calls);
    expect(row.sql).not.toContain('specimen_type');
    expect(row.sql).not.toContain('reporting_point_of_entry');
    expect(row.values).toEqual([SURVEILLANCE_START, 50, 0]);
    expect(page.total).toBe(TOTAL_FROM_COUNT_QUERY);
  });

  it('applies the laboratory and D-32 predicates on the lab dataset', async () => {
    const { service, calls } = harness();
    await service.labResults(
      parse({ lab: 'NVRL', resultStatus: 'POSITIVE', turnaroundBand: '0-1' }),
    );

    const row = rowStatement(calls);
    expect(row.sql).toContain(
      'lower(btrim(testing_laboratory_name)) = lower(btrim($3))',
    );
    expect(row.sql).toContain(
      'lower(btrim(result_category)) = lower(btrim($4))',
    );
    expect(row.sql).toContain(
      'lower(btrim(turnaround_time_band)) = lower(btrim($5))',
    );
    expect(row.values).toEqual([
      '86518-8',
      SURVEILLANCE_START,
      'NVRL',
      'POSITIVE',
      '0-1',
      50,
      0,
    ]);
  });
});

describe('LinelistService EVD scope', () => {
  const EVD_LAB_TEST_CODE = '86518-8';

  it('scopes both the lab row and count statements to the EVD test code', async () => {
    const { service, calls } = harness();
    await service.labResults(parse());

    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.sql).toContain('test_code = $1');
      expect(call.sql).not.toContain(EVD_LAB_TEST_CODE);
      expect(call.values?.[0]).toBe(EVD_LAB_TEST_CODE);
    }
  });

  it('scopes the base CTE, so the anchored window is computed over EVD rows only', async () => {
    const { service, calls } = harness();
    await service.labResults(parse({ period: '7d' }));

    const sql = rowStatement(calls).sql;
    const baseEnd = sql.indexOf('bounds AS (');
    expect(baseEnd).toBeGreaterThan(-1);

    expect(sql.slice(0, baseEnd)).toContain('test_code = $1');
    expect(sql).toContain('max(event_at) AS max_event_at');
  });

  it('projects test_code in the base CTE so the predicate has a column to read', async () => {
    const { service, calls } = harness();
    await service.labResults(parse());

    const sql = rowStatement(calls).sql;
    const baseList =
      /WITH base AS \(\n\s+SELECT\n([\s\S]*?)\n\s+FROM gold/.exec(sql);
    expect(baseList).not.toBeNull();
    expect(
      (baseList as RegExpExecArray)[1].split(',').map((name) => name.trim()),
    ).toContain('test_code');
  });

  it('keeps the scope on a custom range, with the range bound after it', async () => {
    const { service, calls } = harness();
    await service.labResults(
      parse({ period: 'custom', from: '2026-07-01', to: '2026-07-28' }),
    );

    const row = rowStatement(calls);
    expect(row.sql).toContain('test_code = $1');
    expect(row.sql).toContain('event_at >= $2::timestamptz');
    expect(row.sql).toContain('event_at <= $3::timestamptz');
    expect(row.values?.[0]).toBe(EVD_LAB_TEST_CODE);
  });

  it('adds no base predicate to a dataset that declares none', async () => {
    for (const method of ['cases', 'outcomes', 'contacts', 'signals'] as const) {
      const { service, calls } = harness();
      await service[method](parse());

      for (const call of calls) {
        expect(call.sql, method).not.toContain('test_code');
        expect(call.sql, method).not.toContain('surveillance_pathway');
      }
      expect(countStatement(calls).values, method).toEqual([
        SURVEILLANCE_START,
      ]);
    }
  });

  it('scopes the screening drill-down to the traveller pathway by default', async () => {
    const { service, calls } = harness();
    await service.screenings(parse());

    for (const call of calls) {
      expect(call.sql).toContain('surveillance_pathway = $1');
      expect(call.sql.indexOf('surveillance_pathway = $1')).toBeLessThan(
        call.sql.indexOf('bounds AS'),
      );
      expect(call.sql).not.toContain("'TRAVELLER'");
    }
    expect(countStatement(calls).values).toEqual([
      'TRAVELLER',
      SURVEILLANCE_START,
    ]);
  });

  it('scopes facility alert drill-downs to TaifaCare before anchoring', async () => {
    const { service, calls } = harness();
    await service.screenings(
      parse({
        screeningScope: 'facility',
        screeningFlagged: 'true',
        facility: 'Suba Sub County Hospital',
      }),
    );

    for (const call of calls) {
      expect(call.sql).toContain('source_system = $1');
      expect(call.sql.indexOf('source_system = $1')).toBeLessThan(
        call.sql.indexOf('bounds AS'),
      );
      expect(call.sql).toContain(
        'lower(btrim(reporting_facility_name)) = lower(btrim($3))',
      );
      expect(call.sql).toContain(
        'lower(btrim((flagged_screening_count > 0)::text)) = lower(btrim($4))',
      );
    }
    expect(countStatement(calls).values).toEqual([
      'TAIFACARE_KENYAEMR',
      SURVEILLANCE_START,
      'Suba Sub County Hospital',
      'true',
    ]);
  });

  it('filters verified community signals by the mart boolean', async () => {
    const { service, calls } = harness();
    await service.signals(parse({ signalVerified: 'true' }));

    for (const call of calls) {
      expect(call.sql).toContain(
        'lower(btrim(signal_verified::text)) = lower(btrim($2))',
      );
    }
    expect(countStatement(calls).values).toEqual([SURVEILLANCE_START, 'true']);
  });
});

describe('every linelist statement', () => {
  const datasets: ReadonlyArray<
    readonly [keyof LinelistService & string, string]
  > = [
    ['labResults', 'gold.report_lab_result'],
    ['screenings', 'gold.report_screening'],
    ['cases', 'gold.report_case_investigation'],
    ['outcomes', 'gold.report_treatment_outcome'],
    ['contacts', 'gold.report_contact_registration'],
    ['signals', 'gold.report_community_signals'],
  ];

  it.each(datasets)(
    '%s reads exactly one gold table, in both its row and count statements',
    async (method, table) => {
      const { service, calls } = harness();
      await service[method](parse());

      expect(calls).toHaveLength(2);
      for (const call of calls) {
        expect(call.sql).toContain(`FROM ${table}\n`);
      }
    },
  );

  it('names no other medallion layer and uses no star projection', async () => {
    const { service, calls } = harness();
    for (const [method] of datasets) {
      await service[method](parse({ q: 'x', fields: 'source_person_name' }));
    }

    expect(calls).toHaveLength(datasets.length * 2);
    for (const call of calls) {
      expect(call.sql).not.toMatch(/\b(bronze|silver|marts)\./);
      expect(call.sql).not.toMatch(/SELECT \*|select \*/);
    }
  });
});
