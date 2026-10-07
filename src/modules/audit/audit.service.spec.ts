import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { newDb } from 'pg-mem';

import {
  DatabaseService,
  type Queryable,
} from '../../database/database.module.js';
import { AUDIT_EVENT_TYPES, AUDIT_OUTCOMES } from './audit-event.schema.js';
import { redactAuditFilters } from './audit-redaction.js';
import { AuditService } from './audit.service.js';
import { auditQuerySchema } from './dto/audit-query.dto.js';

function okResult() {
  return Promise.resolve({ rows: [], rowCount: 1 });
}

function serviceWith(query: ReturnType<typeof vi.fn>) {
  const db: Queryable = { query } as unknown as Queryable;
  const service = new AuditService(db);
  const logger = { error: vi.fn(), warn: vi.fn(), log: vi.fn() };
  (service as unknown as { logger: typeof logger }).logger = logger;
  return { service, logger };
}

const baseEvent = {
  eventType: 'pii_export',
  actorId: 'user-1',
  actorRole: 'admin,surveillance',
  dataset: 'case_investigation',
  columns: ['source_person_name'],
  filters: { period: '21d' },
};

describe('AuditService.record', () => {
  it('issues exactly one INSERT with nine positional parameters', async () => {
    const query = vi.fn(okResult);
    const { service } = serviceWith(query);

    await service.record({ ...baseEvent, rowCount: 42, outcome: 'ok' });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO audit_events');
    expect(values).toHaveLength(9);
    expect(sql).toContain('$9');
    expect(sql).not.toContain('$10');
  });

  it('never interpolates a value into the SQL text', async () => {
    const query = vi.fn(okResult);
    const { service } = serviceWith(query);

    await service.record({ ...baseEvent, rowCount: 42 });

    const [sql] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toContain('user-1');
    expect(sql).not.toContain('case_investigation');
    expect(sql).not.toContain('source_person_name');
  });

  it('generates a distinct id per call', async () => {
    const query = vi.fn(okResult);
    const { service } = serviceWith(query);

    await service.record(baseEvent);
    await service.record(baseEvent);

    const first = (query.mock.calls[0] as [string, unknown[]])[1][0];
    const second = (query.mock.calls[1] as [string, unknown[]])[1][0];
    expect(first).toEqual(expect.any(String));
    expect(first).not.toBe(second);
  });

  it('persists the default outcome when outcome is omitted', async () => {
    const query = vi.fn(okResult);
    const { service } = serviceWith(query);

    await service.record(baseEvent);

    const values = (query.mock.calls[0] as [string, unknown[]])[1];
    expect(values[8]).toBe('ok');
  });

  it('persists null when rowCount is omitted', async () => {
    const query = vi.fn(okResult);
    const { service } = serviceWith(query);

    await service.record(baseEvent);

    const values = (query.mock.calls[0] as [string, unknown[]])[1];
    expect(values[7]).toBeNull();
  });

  it('serialises filters as JSON and columns as a fresh array', async () => {
    const query = vi.fn(okResult);
    const { service } = serviceWith(query);
    const columns = Object.freeze(['source_person_name']) as readonly string[];

    await service.record({ ...baseEvent, columns });

    const values = (query.mock.calls[0] as [string, unknown[]])[1];
    expect(values[5]).toEqual(['source_person_name']);
    expect(values[5]).not.toBe(columns);
    expect(values[6]).toBe(JSON.stringify({ period: '21d' }));
  });

  it('resolves and logs exactly once when the insert rejects', async () => {
    const query = vi.fn(() =>
      Promise.reject(new Error('relation does not exist')),
    );
    const { service, logger } = serviceWith(query);

    await expect(service.record(baseEvent)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('does not retry, queue or back off when the insert rejects', async () => {
    const query = vi.fn(() =>
      Promise.reject(new Error('relation does not exist')),
    );
    const { service } = serviceWith(query);

    await service.record(baseEvent);

    expect(query).toHaveBeenCalledTimes(1);
  });

  it('names the event type in the failure log', async () => {
    const query = vi.fn(() =>
      Promise.reject(new Error('relation does not exist')),
    );
    const { service, logger } = serviceWith(query);

    await service.record(baseEvent);

    const [message] = logger.error.mock.calls[0] as [string, string?];
    expect(message).toContain('pii_export');
    expect(message).toContain('relation does not exist');
  });
});

describe('redactAuditFilters', () => {
  it('copies schema-closed filters through unchanged', () => {
    expect(
      redactAuditFilters({
        period: '21d',
        sortDir: 'desc',
        screeningScope: 'facility',
        screeningFlagged: 'true',
        signalVerified: 'true',
      }),
    ).toEqual({
      period: '21d',
      sortDir: 'desc',
      screeningScope: 'facility',
      screeningFlagged: 'true',
      signalVerified: 'true',
    });
  });

  it('never carries the free-text search term verbatim', () => {
    const redacted = redactAuditFilters({ q: 'Wanjiku' });
    expect(JSON.stringify(redacted)).not.toContain('Wanjiku');
  });

  it('replaces the search term with its length and a sha256 digest', () => {
    const redacted = redactAuditFilters({ q: 'Wanjiku' }) as {
      qLength: number;
      qSha256: string;
    };
    expect(redacted.qLength).toBe(7);
    expect(redacted.qSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces a stable digest so repeat probing is detectable', () => {
    const first = redactAuditFilters({ q: 'Wanjiku' }) as { qSha256: string };
    const second = redactAuditFilters({ q: 'Wanjiku' }) as { qSha256: string };
    expect(first.qSha256).toBe(second.qSha256);
  });

  it('produces different digests for different search terms', () => {
    const first = redactAuditFilters({ q: 'Wanjiku' }) as { qSha256: string };
    const second = redactAuditFilters({ q: 'Otieno' }) as { qSha256: string };
    expect(first.qSha256).not.toBe(second.qSha256);
  });

  it('drops paging keys and the projection field list', () => {
    const redacted = redactAuditFilters({
      page: 3,
      limit: 50,
      pageSize: 200,
      fields: ['person_name'],
    });
    expect(redacted).toEqual({});
  });

  it('drops any key outside the allowlist', () => {
    expect(redactAuditFilters({ unknownKey: 'x' })).toEqual({});
  });

  it('returns an empty object for undefined and null', () => {
    expect(redactAuditFilters(undefined)).toEqual({});
    expect(redactAuditFilters(null)).toEqual({});
  });

  it('omits undefined values rather than writing them as null', () => {
    const redacted = redactAuditFilters({ period: '21d', lab: undefined });
    expect(Object.keys(redacted)).toEqual(['period']);
  });

  it('omits the derived keys for an empty search term', () => {
    expect(redactAuditFilters({ q: '' })).toEqual({});
  });

  it('carries every structural filter key declared by the operational schema', () => {
    const query = {
      period: '21d',
      from: '2026-01-01',
      to: '2026-02-01',
      sortBy: 'created_date',
      sortDir: 'desc',
      lab: 'a',
      poe: 'b',
      facility: 'c',
      ageGroup: 'd',
      signalStatus: 'e',
      signalType: 'f',
      communitySource: 'g',
      classification: 'h',
      resultStatus: 'i',
      initialClassification: 'j',
      specimenType: 'k',
      testName: 'l',
      turnaroundBand: 'm',
      screeningOutcome: 'n',
      screeningCategory: 'o',
      screeningScope: 'facility',
      screeningFlagged: 'true',
      signalVerified: 'true',
      treatmentOutcome: 'p',
    };

    const redacted = redactAuditFilters(query);

    for (const key of Object.keys(query)) {
      const present =
        key in redacted ||
        (`${key}Length` in redacted && `${key}Sha256` in redacted);
      expect(present, key).toBe(true);
    }
  });
});

const FREE_TEXT_KEYS = [
  'lab',
  'poe',
  'facility',
  'ageGroup',
  'signalStatus',
  'signalType',
  'communitySource',
  'classification',
  'resultStatus',
  'initialClassification',
  'specimenType',
  'testName',
  'turnaroundBand',
  'screeningOutcome',
  'screeningCategory',
  'treatmentOutcome',
] as const;

describe('redactAuditFilters free-text handling', () => {
  it.each(FREE_TEXT_KEYS)(
    'never stores a caller-supplied %s value verbatim',
    (key) => {
      const redacted = redactAuditFilters({ [key]: 'Wanjiku Njeri' });

      expect(JSON.stringify(redacted)).not.toContain('Wanjiku');
      expect(redacted[key]).toBeUndefined();
      expect(redacted[`${key}Length`]).toBe('Wanjiku Njeri'.length);
      expect(redacted[`${key}Sha256`]).toMatch(/^[0-9a-f]{64}$/);
    },
  );

  it('digests a value that looks like a legitimate option no differently', () => {
    const first = redactAuditFilters({ lab: 'NVRL' });
    const second = redactAuditFilters({ lab: 'NVRL' });

    expect(first.labSha256).toBe(second.labSha256);
    expect(first.labSha256).not.toBe(
      redactAuditFilters({ lab: 'KEMRI' }).labSha256,
    );
  });

  it('keys the digest per filter, so the same text under two filters is distinguishable', () => {
    const redacted = redactAuditFilters({
      lab: 'Wanjiku',
      facility: 'Wanjiku',
    });

    expect(redacted.labSha256).toBe(redacted.facilitySha256);
    expect(Object.keys(redacted).sort()).toEqual([
      'facilityLength',
      'facilitySha256',
      'labLength',
      'labSha256',
    ]);
  });

  it('records sortBy verbatim only when it names a registry column', () => {
    expect(redactAuditFilters({ sortBy: 'created_date' })).toEqual({
      sortBy: 'created_date',
    });

    const redacted = redactAuditFilters({ sortBy: 'Wanjiku Njeri' });
    expect(redacted.sortBy).toBeUndefined();
    expect(JSON.stringify(redacted)).not.toContain('Wanjiku');
    expect(redacted.sortBySha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('records a date bound verbatim only when it has a date shape', () => {
    expect(
      redactAuditFilters({ from: '2026-01-01 00:00:00', to: '2026-02-01' }),
    ).toEqual({ from: '2026-01-01 00:00:00', to: '2026-02-01' });

    expect(Number.isNaN(Date.parse('John Smith 2026'))).toBe(false);
    const redacted = redactAuditFilters({ from: 'John Smith 2026' });
    expect(redacted.from).toBeUndefined();
    expect(JSON.stringify(redacted)).not.toContain('John');
    expect(redacted.fromSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('cannot be made to leak by a non-string value on a free-text key', () => {
    expect(redactAuditFilters({ lab: { toString: () => 'Wanjiku' } })).toEqual(
      {},
    );
    expect(redactAuditFilters({ lab: 123 })).toEqual({});
    expect(redactAuditFilters({ lab: '' })).toEqual({});
  });
});

describe('AuditService.findAll actor resolution', () => {
  let pool: Pool;
  let db: DatabaseService;
  let issued: string[];
  let service: AuditService;

  beforeEach(async () => {
    const memoryDb = newDb();
    const adapter = memoryDb.adapters.createPg();
    pool = new adapter.Pool();
    db = new DatabaseService(pool);
    await db.ensureSchema();

    issued = [];
    const counting: Queryable = {
      query: (text: string, values?: unknown[]) => {
        issued.push(text);
        return pool.query(text, values);
      },
    } as unknown as Queryable;
    service = new AuditService(counting);
  });

  afterEach(async () => {
    await pool.end();
  });

  async function seedAccount(id: string, name: string, role: string) {
    await db.query(
      `INSERT INTO "user" (id, name, email, role) VALUES ($1, $2, $3, $4)`,
      [id, name, `${id}@evd.local`, role],
    );
  }

  async function seedEvent(id: string, actorId: string, createdAt: string) {
    await db.query(
      `
        INSERT INTO audit_events
          (id, "eventType", "actorId", "actorRole", dataset, columns, filters, "rowCount", outcome, "createdAt")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        id,
        'pii_export',
        actorId,
        'admin,surveillance',
        'case_investigation',
        ['source_person_name'],
        JSON.stringify({ period: '21d' }),
        3,
        'ok',
        createdAt,
      ],
    );
  }

  it('names the actor by joining the auth user table', async () => {
    await seedAccount('acct-1', 'Achieng Otieno', 'admin,surveillance');
    await seedEvent('audit-1', 'acct-1', '2026-08-10T09:00:00Z');

    const result = await service.findAll(auditQuerySchema.parse({}));

    expect(result.data).toHaveLength(1);
    expect(result.data[0].actorName).toBe('Achieng Otieno');
    expect(result.data[0].actorId).toBe('acct-1');
  });

  it('leaves the name null for a deleted account, keeping the row attributable by id', async () => {
    await seedEvent('audit-1', 'deleted-acct', '2026-08-10T09:00:00Z');

    const result = await service.findAll(auditQuerySchema.parse({}));

    expect(result.data).toHaveLength(1);
    expect(result.data[0].actorName ?? null).toBeNull();
    expect(result.data[0].actorId).toBe('deleted-acct');
    expect(result.total).toBe(1);
  });

  it('resolves every name in the page statement rather than one query per row', async () => {
    await seedAccount('acct-1', 'Achieng Otieno', 'admin');
    await seedAccount('acct-2', 'Barasa Wekesa', 'surveillance');
    await seedEvent('audit-1', 'acct-1', '2026-08-10T09:00:00Z');
    await seedEvent('audit-2', 'acct-2', '2026-08-10T10:00:00Z');
    await seedEvent('audit-3', 'acct-1', '2026-08-10T11:00:00Z');
    issued = [];

    const result = await service.findAll(auditQuerySchema.parse({}));

    expect(result.data).toHaveLength(3);
    expect(result.data.map((row) => row.actorName)).toEqual([
      'Achieng Otieno',
      'Barasa Wekesa',
      'Achieng Otieno',
    ]);
    expect(issued).toHaveLength(2);
  });

  it('carries the account name but not the account email', async () => {
    await seedAccount('acct-1', 'Achieng Otieno', 'admin');
    await seedEvent('audit-1', 'acct-1', '2026-08-10T09:00:00Z');

    const result = await service.findAll(auditQuerySchema.parse({}));

    expect(Object.keys(result.data[0])).not.toContain('email');
    expect(JSON.stringify(result.data[0])).not.toContain('@evd.local');
  });

  it('keeps paging and the newest-first order across the join', async () => {
    await seedAccount('acct-1', 'Achieng Otieno', 'admin');
    await seedEvent('audit-1', 'acct-1', '2026-08-10T09:00:00Z');
    await seedEvent('audit-2', 'acct-1', '2026-08-10T10:00:00Z');
    await seedEvent('audit-3', 'acct-1', '2026-08-10T11:00:00Z');

    const first = await service.findAll(
      auditQuerySchema.parse({ page: '1', limit: '2' }),
    );
    const second = await service.findAll(
      auditQuerySchema.parse({ page: '2', limit: '2' }),
    );

    expect(first.data.map((row) => row.id)).toEqual(['audit-3', 'audit-2']);
    expect(first.total).toBe(3);
    expect(second.data.map((row) => row.id)).toEqual(['audit-1']);
    expect(second.total).toBe(3);
  });

  it('excludes reconciliation events from both general audit data and counts', async () => {
    await seedEvent('access-1', 'acct-1', '2026-10-07T09:00:00Z');
    await seedEvent('record-1', 'acct-1', '2026-10-07T10:00:00Z');
    await db.query(
      `UPDATE audit_events SET "eventType" = 'headline_override' WHERE id = $1`,
      ['record-1'],
    );
    const result = await service.findAll(auditQuerySchema.parse({}));
    expect(result.data.map((event) => event.id)).toEqual(['access-1']);
    expect(result.total).toBe(1);
    const filtered = await service.findAll(
      auditQuerySchema.parse({ eventType: 'headline_override' }),
    );
    expect(filtered.data).toEqual([]);
    expect(filtered.total).toBe(0);
  });

  it('still filters by actor id after the join', async () => {
    await seedAccount('acct-1', 'Achieng Otieno', 'admin');
    await seedAccount('acct-2', 'Barasa Wekesa', 'surveillance');
    await seedEvent('audit-1', 'acct-1', '2026-08-10T09:00:00Z');
    await seedEvent('audit-2', 'acct-2', '2026-08-10T10:00:00Z');

    const result = await service.findAll(
      auditQuerySchema.parse({ actorId: 'acct-2' }),
    );

    expect(result.data.map((row) => row.id)).toEqual(['audit-2']);
    expect(result.total).toBe(1);
  });
});

describe('AUDIT_EVENT_TYPES', () => {
  it('declares the two PII event types and the headline override event type', () => {
    expect(AUDIT_EVENT_TYPES).toEqual([
      'pii_export',
      'pii_column_denied',
      'headline_override',
    ]);
  });

  it('lets the audit query filter on the headline override event type', () => {
    expect(
      auditQuerySchema.parse({ eventType: 'headline_override' }).eventType,
    ).toBe('headline_override');
  });
});

describe('AUDIT_OUTCOMES', () => {
  it('declares every outcome the emit sites write, including aborted', () => {
    expect(AUDIT_OUTCOMES).toEqual(['ok', 'denied', 'error', 'aborted']);
  });

  it('keeps aborted distinct from denied — a partial delivery is a delivery', () => {
    expect(AUDIT_OUTCOMES).toContain('aborted');
    expect(AUDIT_OUTCOMES).toContain('denied');
    expect(new Set(AUDIT_OUTCOMES).size).toBe(AUDIT_OUTCOMES.length);
  });
});
