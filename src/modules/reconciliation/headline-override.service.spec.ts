import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Pool } from 'pg';
import { newDb } from 'pg-mem';

import {
  DatabaseService,
  type Queryable,
} from '../../database/database.module.js';
import { AuditService } from '../audit/audit.service.js';
import {
  HEADLINE_FIGURE_FIELDS,
  type HeadlineOverrideRow,
} from './headline-override.schema.js';
import {
  HeadlineOverrideService,
  type HeadlineOverrideCreateInput,
} from './headline-override.service.js';

const ACTOR = { actorId: 'acct-recon-1', actorRole: 'reconciliation' };

const PRESS_RELEASE: HeadlineOverrideCreateInput = {
  situation_date: '2026-10-06',
  report_date: '2026-10-06',
  source_label: 'CS press release 6 Oct 2026',
  confirmed_cases: 1,
  confirmed_cases_24h: 1,
  recoveries: 0,
  deaths: 1,
  samples_tested_total: 267,
  positive_samples: 1,
  negative_samples: 266,
  travellers_screened_total: 652584,
  contacts_listed: 28,
};

const ROW_FIELDS = [
  'situation_date',
  'report_date',
  'source_label',
  'notes',
  'operational_override',
  ...HEADLINE_FIGURE_FIELDS,
];

interface AuditRow {
  eventType: string;
  actorId: string | null;
  actorRole: string | null;
  dataset: string | null;
  columns: string[] | string;
  filters: Record<string, unknown> | string;
  rowCount: number | null;
  outcome: string;
}

interface OverrideAuditFilters {
  situationDate: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

function toArray(value: string[] | string): string[] {
  if (Array.isArray(value)) return value;
  const inner = value.replace(/^\{/, '').replace(/\}$/, '');
  return inner === '' ? [] : inner.split(',');
}

function toObject(value: Record<string, unknown> | string): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

describe('HeadlineOverrideService on the real schema', () => {
  let pool: Pool;
  let database: DatabaseService;
  let service: HeadlineOverrideService;

  beforeAll(async () => {
    pool = new (newDb().adapters.createPg().Pool)();
    database = new DatabaseService(pool);
    await database.ensureSchema();
    service = new HeadlineOverrideService(database, new AuditService(pool));
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await database.query('DELETE FROM headline_overrides');
    await database.query('DELETE FROM audit_events');
  });

  async function auditRows() {
    const result = await database.query<AuditRow>(
      'SELECT * FROM audit_events ORDER BY "createdAt"',
    );
    return result.rows.map((row) => ({
      ...row,
      columns: toArray(row.columns),
      filters: toObject(row.filters) as OverrideAuditFilters,
    }));
  }

  async function count(table: 'audit_events' | 'headline_overrides') {
    const result = await database.query<{ count: string | number }>(
      `SELECT count(*) AS count FROM ${table}`,
    );
    return Number(result.rows[0].count);
  }

  it('stores exactly what was sent: zero stays zero and a blank stays null', async () => {
    const created = await service.create(PRESS_RELEASE, ACTOR);
    const found = await service.find('2026-10-06');

    expect(created.situation_date).toBe('2026-10-06');
    expect(found).not.toBeNull();
    expect(found!.situation_date).toBe('2026-10-06');
    expect(found!.positive_samples).toBe(1);
    expect(found!.recoveries).toBe(0);
    expect(found!.samples_tested_24h).toBeNull();
    expect(found!.screening_points).toBeNull();
    expect(found!.notes).toBeNull();
    expect(found!.updatedBy).toBe('acct-recon-1');
  });

  it('defaults operational overrides off and audits switching them on', async () => {
    const row = await service.create(PRESS_RELEASE, ACTOR);
    expect(row.operational_override).toBe(false);
    await service.update(
      row.situation_date,
      { operational_override: true },
      ACTOR,
    );
    expect((await service.find(row.situation_date))?.operational_override).toBe(
      true,
    );
    const events = await auditRows();
    const event = events.find((entry) => entry.filters.action === 'update')!;
    expect(event.columns).toEqual(['operational_override']);
    expect(event.filters.before?.operational_override).toBe(false);
    expect(event.filters.after?.operational_override).toBe(true);
  });

  it('paginates history for only the requested date, including cleared records', async () => {
    await service.create(PRESS_RELEASE, ACTOR);
    await service.create(
      { ...PRESS_RELEASE, situation_date: '2026-10-05' },
      ACTOR,
    );
    await service.remove(PRESS_RELEASE.situation_date, ACTOR);
    const first = await service.history(PRESS_RELEASE.situation_date, 1, 1);
    const second = await service.history(PRESS_RELEASE.situation_date, 2, 1);
    expect(first.total).toBe(2);
    expect(first.data).toHaveLength(1);
    expect(second.data).toHaveLength(1);
    expect(first.data[0].id).not.toBe(second.data[0].id);
    for (const event of [...first.data, ...second.data]) {
      expect((event.filters as Record<string, unknown>).situationDate).toBe(
        PRESS_RELEASE.situation_date,
      );
    }
  });

  it('rejects stale edits and clears without changing values or adding audit rows', async () => {
    const row = await service.create(PRESS_RELEASE, ACTOR);
    const edited = await service.update(
      row.situation_date,
      { deaths: 2, expected_revision: row.revision },
      ACTOR,
    );
    expect(edited.revision).toBe(2);
    await expect(
      service.update(
        row.situation_date,
        { deaths: 3, expected_revision: row.revision },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.remove(row.situation_date, ACTOR, row.revision),
    ).rejects.toBeInstanceOf(ConflictException);
    expect((await service.find(row.situation_date))?.deaths).toBe(2);
    expect(await count('audit_events')).toBe(2);
  });

  it('keeps an unchanged save out of the audit trail and preserves the revision', async () => {
    const row = await service.create(PRESS_RELEASE, ACTOR);
    const saved = await service.update(
      row.situation_date,
      { deaths: row.deaths, expected_revision: row.revision },
      ACTOR,
    );
    expect(saved.revision).toBe(row.revision);
    expect(await count('audit_events')).toBe(1);
  });

  it('carries cumulative figures forward within the selected period only', async () => {
    await service.create(PRESS_RELEASE, ACTOR);
    await service.create(
      {
        situation_date: '2026-10-07',
        samples_tested_24h: 8,
        operational_override: true,
      },
      ACTOR,
    );
    const selected = await service.latestAtOrBefore('2026-10-07');
    expect(selected?.confirmed_cases).toBe(1);
    expect(selected?.contacts_listed).toBe(28);
    expect(selected?.samples_tested_24h).toBe(8);
    expect(selected?.confirmed_cases_24h).toBeNull();
    expect(selected?.operational_override).toBe(true);
    expect((await service.latestAtOrBefore('2026-10-06'))?.situation_date).toBe(
      '2026-10-06',
    );
  });

  it('returns null from find for a date with no row', async () => {
    expect(await service.find('2026-10-06')).toBeNull();
  });

  it('writes one headline_override audit row for a create, with the stored values', async () => {
    await service.create(PRESS_RELEASE, ACTOR);

    expect(await count('audit_events')).toBe(1);
    const [event] = await auditRows();
    expect(event.eventType).toBe('headline_override');
    expect(event.dataset).toBe('headline_override');
    expect(event.actorId).toBe('acct-recon-1');
    expect(event.actorRole).toBe('reconciliation');
    expect(event.outcome).toBe('ok');
    expect(event.rowCount).toBe(1);
    expect(event.filters.action).toBe('create');
    expect(event.filters.situationDate).toBe('2026-10-06');
    expect(event.filters.before).toBeNull();
    expect(event.filters.after?.deaths).toBe(1);
    expect(event.filters.after?.samples_tested_24h).toBeNull();
    expect(event.columns).toContain('deaths');
    expect(event.columns).toContain('recoveries');
    expect(event.columns).not.toContain('samples_tested_24h');
  });

  it('rejects a second row for the same date and writes nothing', async () => {
    await service.create(PRESS_RELEASE, ACTOR);

    const second = service.create({ ...PRESS_RELEASE, deaths: 5 }, ACTOR);

    await expect(second).rejects.toBeInstanceOf(ConflictException);
    await expect(second).rejects.toThrow(
      'A row for 2026-10-06 already exists. Edit it instead.',
    );
    expect(await count('headline_overrides')).toBe(1);
    expect(await count('audit_events')).toBe(1);
    expect((await service.find('2026-10-06'))!.deaths).toBe(1);
  });

  it('updates only the keys that were sent: null clears, an omitted key is untouched', async () => {
    await service.create(PRESS_RELEASE, ACTOR);

    const updated = await service.update(
      '2026-10-06',
      { deaths: 2, recoveries: null },
      { actorId: 'acct-recon-2', actorRole: 'admin,reconciliation' },
    );
    const found = await service.find('2026-10-06');

    expect(updated.deaths).toBe(2);
    expect(found!.deaths).toBe(2);
    expect(found!.recoveries).toBeNull();
    expect(found!.confirmed_cases).toBe(1);
    expect(found!.travellers_screened_total).toBe(652584);
    expect(found!.source_label).toBe('CS press release 6 Oct 2026');
    expect(found!.updatedBy).toBe('acct-recon-2');
    expect(new Date(found!.updatedAt!).getTime()).toBeGreaterThanOrEqual(
      new Date(found!.createdAt!).getTime(),
    );
  });

  it('writes one audit row for an update, naming the changed keys with before and after', async () => {
    await service.create(PRESS_RELEASE, ACTOR);

    await service.update('2026-10-06', { deaths: 2, recoveries: null }, ACTOR);

    expect(await count('audit_events')).toBe(2);
    const event = (await auditRows()).find(
      (row) => row.filters.action === 'update',
    )!;
    expect(event.eventType).toBe('headline_override');
    expect([...event.columns].sort()).toEqual(['deaths', 'recoveries']);
    expect(event.filters.situationDate).toBe('2026-10-06');
    expect(event.filters.before?.deaths).toBe(1);
    expect(event.filters.after?.deaths).toBe(2);
    expect(event.filters.before?.recoveries).toBe(0);
    expect(event.filters.after?.recoveries).toBeNull();
  });

  it('rejects an update for a date with no row and writes no audit row', async () => {
    await expect(
      service.update('2026-10-06', { deaths: 2 }, ACTOR),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await count('audit_events')).toBe(0);
  });

  it('clears a row and records what it held', async () => {
    await service.create(PRESS_RELEASE, ACTOR);

    await service.remove('2026-10-06', ACTOR);

    expect(await service.find('2026-10-06')).toBeNull();
    expect(await count('audit_events')).toBe(2);
    const event = (await auditRows()).find(
      (row) => row.filters.action === 'delete',
    )!;
    expect(event.eventType).toBe('headline_override');
    expect(event.filters.after).toBeNull();
    expect(Object.keys(event.filters.before!).sort()).toEqual(
      [...ROW_FIELDS].sort(),
    );
    expect(event.filters.before?.travellers_screened_total).toBe(652584);
    expect([...event.columns].sort()).toEqual([...ROW_FIELDS].sort());
  });

  it('rejects clearing a date with no row', async () => {
    await expect(service.remove('2026-10-06', ACTOR)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(await count('audit_events')).toBe(0);
  });

  it('lists newest first and finds the latest row at or before a period end', async () => {
    await service.create({ situation_date: '2026-10-04', deaths: 0 }, ACTOR);
    await service.create({ situation_date: '2026-09-27', deaths: 0 }, ACTOR);
    await service.create(PRESS_RELEASE, ACTOR);

    const listed = await service.list();
    const beforeGap = await service.latestAtOrBefore('2026-10-05');
    const onTheDay = await service.latestAtOrBefore('2026-10-04');
    const tooEarly = await service.latestAtOrBefore('2026-09-01');
    const overall = await service.latestAtOrBefore(null);

    expect(listed.map((row) => row.situation_date)).toEqual([
      '2026-10-06',
      '2026-10-04',
      '2026-09-27',
    ]);
    expect(beforeGap?.situation_date).toBe('2026-10-04');
    expect(onTheDay?.situation_date).toBe('2026-10-04');
    expect(tooEarly).toBeNull();
    expect(overall?.situation_date).toBe('2026-10-06');
  });
});

interface Statement {
  sql: string;
  values?: unknown[];
}

const STORED_ROW = {
  ...Object.fromEntries(ROW_FIELDS.map((field) => [field, null])),
  ...PRESS_RELEASE,
  updatedBy: 'acct-recon-1',
} as unknown as HeadlineOverrideRow;

function recordingHarness(options: {
  existing: boolean;
  failAudit?: boolean;
  insertError?: Error;
}) {
  const onClient: Statement[] = [];
  const onPool: Statement[] = [];
  let stored: HeadlineOverrideRow | null = options.existing ? STORED_ROW : null;

  const client = {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      onClient.push({ sql, values });
      if (sql.includes('INSERT INTO audit_events') && options.failAudit) {
        throw new Error('audit insert failed');
      }
      if (/^\s*SELECT/i.test(sql)) {
        return { rows: stored ? [stored] : [], rowCount: stored ? 1 : 0 };
      }
      if (sql.includes('INSERT INTO headline_overrides')) {
        if (options.insertError) throw options.insertError;
        stored = STORED_ROW;
      }
      return { rows: [], rowCount: 1 };
    }),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn(async () => client),
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      onPool.push({ sql, values });
      return { rows: [], rowCount: 0 };
    }),
  };

  const database = new DatabaseService(pool as unknown as Pool);
  const service = new HeadlineOverrideService(
    database,
    new AuditService(pool as unknown as Queryable),
  );
  return { service, client, pool, onClient, onPool };
}

function label(sql: string): string {
  const text = sql.trim();
  if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(text)) return text;
  if (/^SELECT/i.test(text)) return 'SELECT';
  if (text.includes('INSERT INTO audit_events')) return 'AUDIT';
  if (/^INSERT INTO headline_overrides/i.test(text)) return 'ROW INSERT';
  if (/^UPDATE headline_overrides/i.test(text)) return 'ROW UPDATE';
  if (/^DELETE FROM headline_overrides/i.test(text)) return 'ROW DELETE';
  return text;
}

const WRITES: Array<{
  name: string;
  existing: boolean;
  rowChange: string;
  run: (service: HeadlineOverrideService) => Promise<unknown>;
}> = [
  {
    name: 'create',
    existing: false,
    rowChange: 'ROW INSERT',
    run: (service) => service.create(PRESS_RELEASE, ACTOR),
  },
  {
    name: 'update',
    existing: true,
    rowChange: 'ROW UPDATE',
    run: (service) =>
      service.update('2026-10-06', { deaths: 2, recoveries: null }, ACTOR),
  },
  {
    name: 'remove',
    existing: true,
    rowChange: 'ROW DELETE',
    run: (service) => service.remove('2026-10-06', ACTOR),
  },
];

describe('HeadlineOverrideService atomicity and parameter discipline', () => {
  it('commits a create as BEGIN, row insert, audit insert, COMMIT on one client', async () => {
    const { service, client, pool, onClient, onPool } = recordingHarness({
      existing: false,
    });

    await service.create(PRESS_RELEASE, ACTOR);

    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(
      onClient
        .map((statement) => label(statement.sql))
        .filter((name) => name !== 'SELECT'),
    ).toEqual(['BEGIN', 'ROW INSERT', 'AUDIT', 'COMMIT']);
    expect(onPool).toEqual([]);
  });

  it.each(WRITES)(
    'runs $name as one transaction: row change, then audit, then COMMIT',
    async ({ existing, rowChange, run }) => {
      const { service, onClient, onPool } = recordingHarness({ existing });

      await run(service);

      expect(
        onClient
          .map((statement) => label(statement.sql))
          .filter((name) => name !== 'SELECT'),
      ).toEqual(['BEGIN', rowChange, 'AUDIT', 'COMMIT']);
      expect(onPool).toEqual([]);
    },
  );

  it.each(WRITES)(
    'rolls $name back and rejects when the audit insert fails',
    async ({ existing, rowChange, run }) => {
      const { service, client, onClient, onPool } = recordingHarness({
        existing,
        failAudit: true,
      });

      await expect(run(service)).rejects.toThrow('audit insert failed');

      const issued = onClient.map((statement) => label(statement.sql));
      expect(issued).toContain(rowChange);
      expect(issued).toContain('ROLLBACK');
      expect(issued).not.toContain('COMMIT');
      expect(issued.indexOf('ROLLBACK')).toBeGreaterThan(
        issued.indexOf('AUDIT'),
      );
      expect(client.release).toHaveBeenCalledTimes(1);
      expect(onPool).toEqual([]);
    },
  );

  it('reports a concurrent duplicate insert as the same conflict, and rolls back', async () => {
    const duplicate = Object.assign(new Error('duplicate key value'), {
      code: '23505',
    });
    const { service, onClient } = recordingHarness({
      existing: false,
      insertError: duplicate,
    });

    const attempt = service.create(PRESS_RELEASE, ACTOR);

    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await expect(attempt).rejects.toThrow(
      'A row for 2026-10-06 already exists. Edit it instead.',
    );
    const issued = onClient.map((statement) => label(statement.sql));
    expect(issued).toContain('ROLLBACK');
    expect(issued).not.toContain('COMMIT');
    expect(issued).not.toContain('AUDIT');
  });

  it.each(WRITES)(
    'never writes a date, a figure or an actor id into the SQL text of $name',
    async ({ existing, run }) => {
      const { service, onClient } = recordingHarness({ existing });

      await run(service);

      expect(onClient.length).toBeGreaterThan(3);
      for (const { sql } of onClient) {
        expect(sql).not.toContain('2026-10-06');
        expect(sql).not.toContain('652584');
        expect(sql).not.toContain('acct-recon-1');
        expect(sql).not.toContain('CS press release');
      }
    },
  );

  it('sends the figure, the date and the actor as parameters of the row insert', async () => {
    const { service, onClient } = recordingHarness({ existing: false });

    await service.create(PRESS_RELEASE, ACTOR);

    const insert = onClient.find(
      (statement) => label(statement.sql) === 'ROW INSERT',
    )!;
    expect(insert.values).toHaveLength(ROW_FIELDS.length + 2);
    expect(insert.values).toContain('2026-10-06');
    expect(insert.values).toContain(652584);
    expect(insert.values).toContain('acct-recon-1');
    expect(insert.values).toContain(null);
    expect(insert.values).toContain(0);
  });
});

describe('AuditService.recordOrThrow', () => {
  const event = {
    eventType: 'headline_override',
    actorId: 'acct-recon-1',
    actorRole: 'reconciliation',
    dataset: 'headline_override',
    columns: ['deaths'],
    filters: { situationDate: '2026-10-06', action: 'update' },
    rowCount: 1,
  };

  it('issues the insert on the supplied client and not on its own pool', async () => {
    const own = vi.fn(() => Promise.resolve({ rows: [], rowCount: 1 }));
    const supplied = vi.fn(() => Promise.resolve({ rows: [], rowCount: 1 }));
    const service = new AuditService({ query: own } as unknown as Queryable);

    await service.recordOrThrow(event, {
      query: supplied,
    } as unknown as Queryable);

    expect(own).not.toHaveBeenCalled();
    expect(supplied).toHaveBeenCalledTimes(1);
    const [sql, values] = supplied.mock.calls[0] as unknown as [
      string,
      unknown[],
    ];
    expect(sql).toContain('INSERT INTO audit_events');
    expect(values).toHaveLength(9);
    expect(values[1]).toBe('headline_override');
    expect(values[6]).toBe(JSON.stringify(event.filters));
    expect(values[8]).toBe('ok');
  });

  it('uses its own pool when no client is supplied', async () => {
    const own = vi.fn(() => Promise.resolve({ rows: [], rowCount: 1 }));
    const service = new AuditService({ query: own } as unknown as Queryable);

    await service.recordOrThrow(event);

    expect(own).toHaveBeenCalledTimes(1);
  });

  it('rejects when the insert rejects', async () => {
    const own = vi.fn(() => Promise.reject(new Error('relation gone')));
    const service = new AuditService({ query: own } as unknown as Queryable);

    await expect(service.recordOrThrow(event)).rejects.toThrow('relation gone');
  });
});
