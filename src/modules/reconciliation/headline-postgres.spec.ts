import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../database/database.module.js';
import { AuditService } from '../audit/audit.service.js';
import { HeadlineOverrideService } from './headline-override.service.js';
import { seedHeadlineOverrides } from '../../scripts/seed-headline-overrides.js';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { betterAuth } from 'better-auth';
import { admin as adminPlugin } from 'better-auth/plugins';
import { kyselyAdapter } from '@better-auth/kysely-adapter';
import { Kysely, PostgresDialect } from 'kysely';
import { ReconciliationController } from './reconciliation.controller.js';
import { AnalyticsService } from '../analytics/analytics.service.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';

// Opt in with HEADLINE_POSTGRES_TEST=1 and DATABASE_URL. Every table and forced
// failure lives in a unique schema; existing application records are untouched.
describe.skipIf(process.env.HEADLINE_POSTGRES_TEST !== '1')(
  'headline writes on PostgreSQL',
  () => {
    const schema = `headline_test_${randomUUID().replaceAll('-', '')}`;
    const actor = { actorId: 'integration-actor', actorRole: 'reconciliation' };
    let admin: Pool;
    let pool: Pool;
    let database: DatabaseService;
    let audit: AuditService;
    let service: HeadlineOverrideService;

    beforeAll(async () => {
      admin = new Pool({ connectionString: process.env.DATABASE_URL });
      await admin.query(`CREATE SCHEMA ${schema}`);
      pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        options: `-c search_path=${schema}`,
      });
      database = new DatabaseService(pool);
      await database.ensureSchema();
      await database.ensureSchema();
      audit = new AuditService(pool);
      service = new HeadlineOverrideService(database, audit);
    });

    afterAll(async () => {
      await pool?.end();
      await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin?.end();
    });

  beforeEach(async () => {
      await pool.query(
        'DELETE FROM headline_overrides; DELETE FROM audit_events',
      );
  });

  it('runs the compiled production seed entrypoint twice in the isolated schema', async () => {
    const url = new URL(process.env.DATABASE_URL!);
    url.searchParams.set('options', `-c search_path=${schema}`);
    const run = () => promisify(execFile)(process.execPath, ['dist/src/scripts/seed-headline-overrides.js'], {
      env: { ...process.env, AUTH_DATABASE_URL: url.toString(), DATABASE_URL: url.toString() },
    });
    expect((await run()).stdout).toContain('Rows inserted: 9');
    expect((await run()).stdout).toContain('Rows inserted: 0');
    expect((await service.list())).toHaveLength(9);
    expect((await pool.query('SELECT count(*)::int AS count FROM audit_events')).rows[0].count).toBe(9);
  });

    it('seeds once, defaults operational off, and separates the two audit views', async () => {
      expect(await seedHeadlineOverrides(service)).toEqual({
        inserted: 9,
        skipped: 0,
      });
      expect(await seedHeadlineOverrides(service)).toEqual({
        inserted: 0,
        skipped: 9,
      });
      const rows = await service.list();
      expect(rows).toHaveLength(9);
      expect(
        rows.every(
          (row) => row.operational_override === false && row.revision === 1,
        ),
      ).toBe(true);
      expect(
        (await pool.query('SELECT count(*)::int AS count FROM audit_events'))
          .rows[0].count,
      ).toBe(9);
      const history = await service.history('2026-10-06', 1, 20);
      expect(history.total).toBe(1);
      expect(history.data[0].filters.after.confirmed_cases).toBe(1);
      expect((await audit.findAll({ page: 1, limit: 20 })).total).toBe(0);
    });

    it('rolls back create, update and delete when the audit insert fails', async () => {
      const row = await service.create(
        { situation_date: '2026-10-06', confirmed_cases: 1 },
        actor,
      );
      await pool.query(
        `ALTER TABLE audit_events ADD CONSTRAINT reject_test_audit CHECK ("actorId" IS DISTINCT FROM 'integration-actor') NOT VALID`,
      );
      try {
        await expect(
          service.create({ situation_date: '2026-10-07' }, actor),
        ).rejects.toThrow();
        await expect(
          service.update(
            row.situation_date,
            { expected_revision: 1, confirmed_cases: 2 },
            actor,
          ),
        ).rejects.toThrow();
        await expect(
          service.remove(row.situation_date, actor, 1),
        ).rejects.toThrow();
        expect(await service.find('2026-10-07')).toBeNull();
        expect(await service.find(row.situation_date)).toMatchObject({
          confirmed_cases: 1,
          revision: 1,
        });
        expect((await service.history(row.situation_date, 1, 20)).total).toBe(
          1,
        );
      } finally {
        await pool.query(
          'ALTER TABLE audit_events DROP CONSTRAINT reject_test_audit',
        );
      }
    });

    it('rejects an old form after the situation date is deleted and recreated', async () => {
      const old = await service.create(
        { situation_date: '2026-10-06', confirmed_cases: 1 },
        actor,
      );
      await service.remove(
        old.situation_date,
        actor,
        old.revision,
        old.record_id,
      );
      const replacement = await service.create(
        { situation_date: old.situation_date, confirmed_cases: 2 },
        actor,
      );
      expect(replacement.revision).toBe(old.revision);
      expect(replacement.record_id).not.toBe(old.record_id);
      await expect(
        service.update(
          old.situation_date,
          {
            confirmed_cases: 3,
            expected_revision: old.revision,
            expected_record_id: old.record_id,
          },
          actor,
        ),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        service.remove(old.situation_date, actor, old.revision, old.record_id),
      ).rejects.toMatchObject({ status: 409 });
      expect((await service.find(old.situation_date))?.confirmed_cases).toBe(2);
      expect((await service.history(old.situation_date, 1, 20)).total).toBe(3);
    });

    it('allows only one concurrent save at the same revision and rejects a stale clear', async () => {
      const row = await service.create(
        { situation_date: '2026-10-06', confirmed_cases: 1 },
        actor,
      );
      const results = await Promise.allSettled(
        [2, 3].map((confirmed_cases) =>
          service.update(
            row.situation_date,
            { confirmed_cases, expected_revision: 1 },
            actor,
          ),
        ),
      );
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      const rejected = results.find(
        (result) => result.status === 'rejected',
      ) as PromiseRejectedResult;
      expect(rejected.reason.getStatus()).toBe(409);
      expect((await service.find(row.situation_date))?.revision).toBe(2);
      await expect(
        service.remove(row.situation_date, actor, 1),
      ).rejects.toMatchObject({ status: 409 });
      expect((await service.history(row.situation_date, 1, 20)).total).toBe(2);
    });

    it('enforces real Better Auth sessions, grants, validation and record CRUD over HTTP', async () => {
      const authPool = new Pool({
        connectionString: process.env.DATABASE_URL,
        options: `-c search_path=${schema}`,
      });
      const authDb = new Kysely({
        dialect: new PostgresDialect({ pool: authPool }),
      });
      const auth = betterAuth({
        database: kyselyAdapter(authDb as never, { type: 'postgres' }),
        secret: randomUUID().replaceAll('-', ''),
        baseURL: 'http://127.0.0.1',
        basePath: '/api/auth',
        emailAndPassword: { enabled: true },
        plugins: [adminPlugin()],
      });
      // Vitest's transform omits TypeScript constructor metadata.
      Reflect.defineMetadata(
        'design:paramtypes',
        [HeadlineOverrideService, AnalyticsService],
        ReconciliationController,
      );
      const module = await Test.createTestingModule({
        imports: [AuthModule.forRoot({ auth })],
        controllers: [ReconciliationController],
        providers: [
          { provide: HeadlineOverrideService, useValue: service },
          {
            provide: AnalyticsService,
            useValue: {
              getWarehouseHeadline: async () => ({
                figures: {},
                lastUpdated: null,
              }),
            },
          },
          {
            provide: RolesGuard,
            useFactory: (reflector: Reflector) => new RolesGuard(reflector),
            inject: [Reflector],
          },
        ],
      }).compile();
      const app = module.createNestApplication({
        bodyParser: false,
        logger: false,
      });
      try {
        await app.listen(0, '127.0.0.1');
        const base = await app.getUrl();
        const request = (
          path: string,
          cookie = '',
          method = 'GET',
          body?: unknown,
        ) =>
          fetch(`${base}/api/${path}`, {
            method,
            headers: {
              'Content-Type': 'application/json',
              ...(cookie ? { cookie } : {}),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
          });
        expect((await request('reconciliation/headline')).status).toBe(401);
        const password = `${randomUUID()}Aa1!`;
        async function session(role: string) {
          const email = `${randomUUID()}@example.invalid`;
          const signup = await request('auth/sign-up/email', '', 'POST', {
            name: role,
            email,
            password,
          });
          expect(signup.status).toBe(200);
          await pool.query('UPDATE "user" SET role = $1 WHERE email = $2', [
            role,
            email,
          ]);
          const login = await request('auth/sign-in/email', '', 'POST', {
            email,
            password,
          });
          expect(login.status).toBe(200);
          return login.headers
            .getSetCookie()
            .map((cookie) => cookie.split(';')[0])
            .join('; ');
        }
        const adminCookie = await session('admin');
        expect(
          (await request('reconciliation/headline', adminCookie)).status,
        ).toBe(403);
        expect(
          (
            await request(
              'reconciliation/headline/2026-10-06/history',
              adminCookie,
            )
          ).status,
        ).toBe(403);
        const cookie = await session('reconciliation');
        const create = await request(
          'reconciliation/headline',
          cookie,
          'POST',
          { situation_date: '2026-10-06', confirmed_cases: 1 },
        );
        expect(create.status).toBe(201);
        const row = await create.json();
        expect(row.operational_override).toBe(false);
        expect((await request('reconciliation/headline', cookie)).status).toBe(
          200,
        );
        expect(
          (
            await request(
              'reconciliation/headline/2026-10-06/history?page=0',
              cookie,
            )
          ).status,
        ).toBe(400);
        expect(
          (
            await request(
              'reconciliation/headline/2026-10-06/history?limit=101',
              cookie,
            )
          ).status,
        ).toBe(400);
        expect(
          (
            await request(
              'reconciliation/headline/2026-10-06',
              cookie,
              'PATCH',
              { confirmed_cases: 2 },
            )
          ).status,
        ).toBe(400);
        const precondition = {
          expected_revision: row.revision,
          expected_record_id: row.record_id,
        };
        const update = await request(
          'reconciliation/headline/2026-10-06',
          cookie,
          'PATCH',
          { ...precondition, confirmed_cases: 2, operational_override: true },
        );
        expect(update.status).toBe(200);
        const updated = await update.json();
        expect(
          (
            await request(
              'reconciliation/headline/2026-10-06',
              cookie,
              'PATCH',
              { ...precondition, confirmed_cases: 3 },
            )
          ).status,
        ).toBe(409);
        const history = await (
          await request('reconciliation/headline/2026-10-06/history', cookie)
        ).json();
        expect(history.total).toBe(2);
        expect(history.data[0].filters).toMatchObject({
          before: { confirmed_cases: 1 },
          after: { confirmed_cases: 2 },
        });
        const query = new URLSearchParams({
          expected_revision: String(updated.revision),
          expected_record_id: updated.record_id,
        });
        expect(
          (
            await request(
              `reconciliation/headline/2026-10-06?${query}`,
              cookie,
              'DELETE',
            )
          ).status,
        ).toBe(204);
        expect(
          (await request('reconciliation/headline/2026-10-06', cookie)).status,
        ).toBe(404);
        expect(
          (
            await (
              await request(
                'reconciliation/headline/2026-10-06/history',
                cookie,
              )
            ).json()
          ).total,
        ).toBe(3);
      } finally {
        await app.close();
        await authDb.destroy();
      }
    }, 20000);
  },
);
