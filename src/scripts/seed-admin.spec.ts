import { describe, it, expect, afterAll, beforeAll, beforeEach } from 'vitest';
import { newDb } from 'pg-mem';
import { Pool } from 'pg';

import { DatabaseService } from '../database/database.module.js';
import { upsertAdminAuthUser } from './seed-admin.js';

describe('seed-admin script', () => {
  let pool: Pool;
  let db: DatabaseService;

  beforeAll(async () => {
    const memoryDb = newDb();
    const adapter = memoryDb.adapters.createPg();
    pool = new adapter.Pool();
    db = new DatabaseService(pool);
    await db.ensureSchema();
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await db.query('DELETE FROM account');
    await db.query('DELETE FROM "user"');
  });

  it('creates a credential account for an existing admin user without one', async () => {
    await db.query(
      `
        INSERT INTO "user" (
          id, name, email, "emailVerified", role
        )
        VALUES ($1, $2, $3, true, $4)
      `,
      ['existing-admin-id', 'Existing Admin', 'admin@example.com', 'user'],
    );

    const result = await upsertAdminAuthUser(pool, {
      fullName: 'Existing Admin',
      email: 'ADMIN@example.com',
      password: 'password123',
    });

    const user = await db.query<{ role: string; email: string }>(
      'SELECT role, email FROM "user" WHERE id = $1',
      ['existing-admin-id'],
    );
    const account = await db.query<{
      userId: string;
      accountId: string;
      providerId: string;
      password: string;
    }>('SELECT * FROM account WHERE "userId" = $1', ['existing-admin-id']);

    expect(result).toMatchObject({ created: false, accountCreated: true });
    expect(user.rows[0].role).toBe('admin');
    expect(user.rows[0].email).toBe('admin@example.com');
    expect(account.rows[0]).toMatchObject({
      userId: 'existing-admin-id',
      accountId: 'existing-admin-id',
      providerId: 'credential',
    });
    expect(account.rows[0].password).toEqual(
      expect.stringMatching(/^[a-f0-9]+:[a-f0-9]+$/),
    );
  });
});
