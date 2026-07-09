import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { newDb } from 'pg-mem';
import { Pool } from 'pg';

import { DatabaseService } from '../../database/database.module.js';
import { UserAccountService } from './user-account.service.js';
import {
  USER_INVITE_SENDER,
  type UserInviteSender,
} from './user-invite.service.js';

describe('UserAccountService', () => {
  let service: UserAccountService;
  let db: DatabaseService;
  let pool: Pool;
  let module: TestingModule;
  let inviteSender: {
    sendInvite: ReturnType<typeof vi.fn>;
  };

  beforeAll(async () => {
    const memoryDb = newDb();
    const adapter = memoryDb.adapters.createPg();
    pool = new adapter.Pool();
    db = new DatabaseService(pool);
    await db.ensureSchema();

    inviteSender = {
      sendInvite: vi.fn().mockResolvedValue(undefined),
    };

    module = await Test.createTestingModule({
      providers: [
        UserAccountService,
        { provide: DatabaseService, useValue: db },
        {
          provide: USER_INVITE_SENDER,
          useValue: inviteSender satisfies UserInviteSender,
        },
      ],
    }).compile();

    service = module.get<UserAccountService>(UserAccountService);
  });

  afterAll(async () => {
    await module.close();
    await pool.end();
  });

  beforeEach(async () => {
    await db.query('DELETE FROM session');
    await db.query('DELETE FROM account');
    await db.query('DELETE FROM "user"');
    inviteSender.sendInvite.mockClear();
  });

  it('creates a login user without creating side-domain records', async () => {
    const created = await service.create({
      name: 'Jane Maina',
      email: 'JANE@example.com',
      password: 'password123',
      role: 'user',
    });

    expect(created.email).toBe('jane@example.com');
    expect(created.name).toBe('Jane Maina');
    expect(created.role).toBe('user');
    expect(await countRows('account')).toBe(1);
    expect(inviteSender.sendInvite).not.toHaveBeenCalled();
  });

  it('sends an invite when an admin creates a login user without a password', async () => {
    const created = await service.create(
      {
        name: 'Invite User',
        email: 'INVITE@example.com',
        role: 'user',
      },
      'dashboard',
    );

    expect(created.email).toBe('invite@example.com');
    expect(await countRows('account')).toBe(0);
    expect(inviteSender.sendInvite).toHaveBeenCalledTimes(1);
    expect(inviteSender.sendInvite).toHaveBeenCalledWith({
      appId: 'dashboard',
      email: 'invite@example.com',
    });
  });

  it('updates only the user full name for self profile edits', async () => {
    const created = await service.create({
      name: 'Jane Maina',
      email: 'jane@example.com',
      password: 'password123',
      role: 'user',
    });

    const updated = await service.updateMe(String(created.id), {
      name: 'Jane Wanjiku Maina',
    });

    expect(updated.name).toBe('Jane Wanjiku Maina');
    expect(updated.email).toBe('jane@example.com');
  });

  it('updates the user profile image for self profile edits', async () => {
    const created = await service.create({
      name: 'Jane Maina',
      email: 'jane@example.com',
      password: 'password123',
      role: 'user',
    });

    const updated = await service.updateMe(String(created.id), {
      image: '/uploads/profile/jane.jpg',
    });
    expect(updated.image).toBe('/uploads/profile/jane.jpg');

    const removed = await service.updateMe(String(created.id), {
      image: null,
    });
    expect(removed.image).toBeNull();
  });

  it('updates login user profile fields for admin edits', async () => {
    const created = await service.create({
      name: 'Response User',
      email: 'response@example.com',
      password: 'password123',
      role: 'user',
    });

    const updated = await service.update(String(created.id), {
      name: 'Response Admin',
      email: 'RESPONSE.ADMIN@example.com',
      role: 'admin',
    });

    expect(updated.name).toBe('Response Admin');
    expect(updated.email).toBe('response.admin@example.com');
    expect(updated.role).toBe('admin');

    const reloaded = await service.findOne(String(created.id));
    expect(reloaded.name).toBe('Response Admin');
    expect(reloaded.email).toBe('response.admin@example.com');
    expect(reloaded.role).toBe('admin');
  });

  it('deactivates a user by banning the auth account and revoking sessions', async () => {
    const created = await service.create({
      name: 'Blocked User',
      email: 'blocked@example.com',
      password: 'password123',
      role: 'user',
    });
    await db.query(
      'INSERT INTO session (id, "userId", token) VALUES ($1, $2, $3)',
      ['session-id', created.id, 'session-token'],
    );

    const deactivated = await service.deactivate(
      String(created.id),
      'requested',
    );

    expect(deactivated.status).toBe('inactive');
    expect(await countRows('session')).toBe(0);
  });

  it('deletes a login user and its credential/session records only', async () => {
    const created = await service.create({
      name: 'Plain User',
      email: 'plain@example.com',
      password: 'password123',
      role: 'user',
    });
    await db.query(
      'INSERT INTO session (id, "userId", token) VALUES ($1, $2, $3)',
      ['session-id', created.id, 'session-token'],
    );

    await service.remove(String(created.id));

    expect(await countRows('"user"')).toBe(0);
    expect(await countRows('account')).toBe(0);
    expect(await countRows('session')).toBe(0);
  });

  async function countRows(table: string): Promise<number> {
    const result = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${table}`,
    );
    return Number(result.rows[0].count);
  }
});
