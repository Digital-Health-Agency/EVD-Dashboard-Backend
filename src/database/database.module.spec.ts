import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { newDb } from 'pg-mem';
import { Pool } from 'pg';

import { envConfig } from '../config/env.config.js';
import { HEADLINE_FIGURE_FIELDS } from '../modules/reconciliation/headline-override.schema.js';
import {
  ANALYTICS_POSTGRES_POOL,
  AUTH_POSTGRES_POOL,
  DatabaseModule,
  DatabaseService,
  POSTGRES_POOL,
} from './database.module.js';

describe('DatabaseModule', () => {
  const trackedEnv = [
    'DATABASE_URL',
    'AUTH_DATABASE_URL',
    'ANALYTICS_DATABASE_URL',
  ] as const;
  let previousEnv: Record<(typeof trackedEnv)[number], string | undefined>;

  beforeEach(() => {
    previousEnv = Object.fromEntries(
      trackedEnv.map((key) => [key, process.env[key]]),
    ) as Record<(typeof trackedEnv)[number], string | undefined>;
  });

  afterEach(() => {
    for (const key of trackedEnv) {
      const previous = previousEnv[key];
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    }
  });

  it('provides separate auth and analytics Postgres pools', async () => {
    process.env.DATABASE_URL =
      'postgres://legacy:pass@localhost:5432/legacy_test';
    process.env.AUTH_DATABASE_URL =
      'postgres://auth:pass@localhost:5432/auth_test';
    process.env.ANALYTICS_DATABASE_URL =
      'postgres://analytics:pass@localhost:5433/analytics_test';

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          isGlobal: true,
          load: [envConfig],
        }),
        DatabaseModule,
      ],
    }).compile();

    try {
      const authPool = moduleRef.get<Pool>(AUTH_POSTGRES_POOL);
      const analyticsPool = moduleRef.get<Pool>(ANALYTICS_POSTGRES_POOL);
      const legacyPool = moduleRef.get<Pool>(POSTGRES_POOL);

      expect(authPool).toBeInstanceOf(Pool);
      expect(analyticsPool).toBeInstanceOf(Pool);
      expect(legacyPool).toBe(authPool);
      expect(authPool.options.connectionString).toBe(
        process.env.AUTH_DATABASE_URL,
      );
      expect(analyticsPool.options.connectionString).toBe(
        process.env.ANALYTICS_DATABASE_URL,
      );
    } finally {
      await moduleRef.close();
    }
  });
});

function toArray(value: string[] | string): string[] {
  if (Array.isArray(value)) return value;
  const inner = value.replace(/^\{/, '').replace(/\}$/, '');
  return inner === '' ? [] : inner.split(',');
}

function toObject(value: Record<string, unknown> | string): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

describe('DatabaseService.ensureSchema audit_events', () => {
  const AUDIT_EVENT_COLUMNS = [
    'id',
    'eventType',
    'actorId',
    'actorRole',
    'dataset',
    'columns',
    'filters',
    'rowCount',
    'outcome',
    'createdAt',
  ];

  let pool: Pool;
  let db: DatabaseService;

  beforeEach(async () => {
    const memoryDb = newDb();
    const adapter = memoryDb.adapters.createPg();
    pool = new adapter.Pool();
    db = new DatabaseService(pool);
    await db.ensureSchema();
  });

  afterEach(async () => {
    await pool.end();
  });

  it('materialises audit_events with exactly the ten audit columns', async () => {
    const result = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'audit_events'`,
    );

    expect(new Set(result.rows.map((row) => row.column_name))).toEqual(
      new Set(AUDIT_EVENT_COLUMNS),
    );
    expect(result.rows).toHaveLength(AUDIT_EVENT_COLUMNS.length);
  });

  it('round trips an audit row with an array of columns and a jsonb filters object', async () => {
    await db.query(
      `
        INSERT INTO audit_events
          (id, "eventType", "actorId", "actorRole", dataset, columns, filters, "rowCount", outcome)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        'audit-1',
        'pii_export',
        'user-1',
        'admin,surveillance',
        'case_investigation',
        ['source_person_name', 'source_person_identifier'],
        JSON.stringify({ period: '21d', qLength: 7 }),
        42,
        'ok',
      ],
    );

    const read = await db.query<{
      columns: string[];
      filters: Record<string, unknown>;
      rowCount: number;
      outcome: string;
      createdAt: Date | string;
    }>(`SELECT * FROM audit_events WHERE id = $1`, ['audit-1']);

    expect(read.rows).toHaveLength(1);
    const row = read.rows[0];
    expect(row.columns).toEqual([
      'source_person_name',
      'source_person_identifier',
    ]);
    expect(row.filters).toEqual({ period: '21d', qLength: 7 });
    expect(row.rowCount).toBe(42);
    expect(row.outcome).toBe('ok');
    expect(row.createdAt).toBeTruthy();
  });

  it('defaults columns and filters to empty rather than null, and leaves rowCount nullable (pg-mem renders a defaulted array as its literal text form, real Postgres as an array)', async () => {
    await db.query(
      `INSERT INTO audit_events (id, "eventType") VALUES ($1, $2)`,
      ['audit-2', 'pii_column_denied'],
    );

    const read = await db.query<{
      columns: string[] | string;
      filters: Record<string, unknown> | string;
      rowCount: number | null;
      outcome: string;
      actorId: string | null;
    }>(`SELECT * FROM audit_events WHERE id = $1`, ['audit-2']);

    const row = read.rows[0];
    expect(row.columns).not.toBeNull();
    expect(toArray(row.columns)).toEqual([]);
    expect(row.filters).not.toBeNull();
    expect(toObject(row.filters)).toEqual({});
    expect(row.rowCount).toBeNull();
    expect(row.actorId).toBeNull();
    expect(row.outcome).toBe('ok');
  });
});

describe('DatabaseService.ensureSchema headline_overrides', () => {
  const HEADLINE_OVERRIDE_COLUMNS = [
    'situation_date',
    'report_date',
    'source_label',
    'notes',
    'operational_override',
    'revision',
    'record_id',
    'confirmed_cases',
    'confirmed_cases_24h',
    'recoveries',
    'deaths',
    'samples_tested_total',
    'samples_tested_24h',
    'positive_samples',
    'negative_samples',
    'travellers_screened_total',
    'travellers_screened_24h',
    'screening_points',
    'contacts_listed',
    'updatedBy',
    'createdAt',
    'updatedAt',
  ];
  const NON_FIGURE_COLUMNS = new Set([
    'situation_date',
    'report_date',
    'source_label',
    'notes',
    'operational_override',
    'revision',
    'record_id',
    'updatedBy',
    'createdAt',
    'updatedAt',
  ]);

  interface StoredRow {
    deaths: number | null;
    samples_tested_24h: number | null;
    positive_samples: number | null;
    contacts_listed: number | null;
    createdAt: Date | string | null;
    updatedAt: Date | string | null;
  }

  let pool: Pool;
  let db: DatabaseService;

  beforeEach(async () => {
    const memoryDb = newDb();
    const adapter = memoryDb.adapters.createPg();
    pool = new adapter.Pool();
    db = new DatabaseService(pool);
    await db.ensureSchema();
  });

  afterEach(async () => {
    await pool.end();
  });

  function insert(row: Record<string, string | number | null>) {
    const columns = Object.keys(row);
    const placeholders = columns.map((_, index) => `$${index + 1}`);
    return db.query(
      `INSERT INTO headline_overrides (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`,
      Object.values(row),
    );
  }

  async function stored(situationDate: string): Promise<StoredRow> {
    const read = await db.query<StoredRow>(
      `SELECT * FROM headline_overrides WHERE situation_date = $1`,
      [situationDate],
    );
    expect(read.rows).toHaveLength(1);
    return read.rows[0];
  }

  async function tableColumns(): Promise<string[]> {
    const result = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'headline_overrides'`,
    );
    return result.rows.map((row) => row.column_name);
  }

  it('materialises headline_overrides with the figure columns and operational toggle', async () => {
    const columns = await tableColumns();

    expect(HEADLINE_OVERRIDE_COLUMNS).toHaveLength(22);
    expect(new Set(columns)).toEqual(new Set(HEADLINE_OVERRIDE_COLUMNS));
    expect(columns).toHaveLength(HEADLINE_OVERRIDE_COLUMNS.length);
  });

  it('keeps the twelve figure columns equal to HEADLINE_FIGURE_FIELDS as a set', async () => {
    const figures = new Set<string>(HEADLINE_FIGURE_FIELDS);
    const isFigure = (column: string) => !NON_FIGURE_COLUMNS.has(column);

    expect(figures.size).toBe(12);
    expect(new Set(HEADLINE_OVERRIDE_COLUMNS.filter(isFigure))).toEqual(
      figures,
    );
    expect(new Set((await tableColumns()).filter(isFigure))).toEqual(figures);
  });

  it('round trips the 2026-10-06 official row and stamps createdAt and updatedAt by default', async () => {
    await insert({
      situation_date: '2026-10-06',
      report_date: '2026-10-06',
      source_label: 'CS press release 6 Oct 2026',
      confirmed_cases: 1,
      confirmed_cases_24h: 1,
      recoveries: 0,
      deaths: 1,
      samples_tested_total: 267,
      samples_tested_24h: null,
      positive_samples: 1,
      negative_samples: 266,
      travellers_screened_total: 652584,
      travellers_screened_24h: null,
      screening_points: null,
      contacts_listed: 28,
    });

    const row = await stored('2026-10-06');
    expect(row.positive_samples).toBe(1);
    expect(row.samples_tested_24h).toBeNull();
    expect(row.deaths).toBe(1);
    expect(row.createdAt).toBeTruthy();
    expect(row.updatedAt).toBeTruthy();
  });

  it('keeps a reported zero apart from a blank', async () => {
    await insert({
      situation_date: '2026-09-27',
      positive_samples: 0,
      contacts_listed: null,
    });

    const row = await stored('2026-09-27');
    expect(row.positive_samples).toBe(0);
    expect(row.contacts_listed).toBeNull();
  });

  it('rejects a second row for the same situation_date', async () => {
    await insert({ situation_date: '2026-10-06', deaths: 1 });

    await expect(
      insert({ situation_date: '2026-10-06', deaths: 2 }),
    ).rejects.toThrow();
    expect((await stored('2026-10-06')).deaths).toBe(1);
  });

  it('survives a second ensureSchema with its rows intact (pg-mem rejects a repeated CREATE TABLE IF NOT EXISTS unless its AST coverage check is off)', async () => {
    await pool.end();
    pool = new (newDb({ noAstCoverageCheck: true }).adapters.createPg().Pool)();
    db = new DatabaseService(pool);
    await db.ensureSchema();
    await insert({ situation_date: '2026-10-06', deaths: 1 });

    await expect(db.ensureSchema()).resolves.toBeUndefined();
    expect((await stored('2026-10-06')).deaths).toBe(1);
  });
});
