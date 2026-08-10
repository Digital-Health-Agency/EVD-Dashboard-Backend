import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { newDb } from 'pg-mem';
import { Pool } from 'pg';

import { envConfig } from '../config/env.config.js';
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
