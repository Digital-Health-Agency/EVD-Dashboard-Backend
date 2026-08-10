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
  createUserSchema,
  updateMeSchema,
  updateUserSchema,
} from './dto/user-account.dto.js';
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

  it('persists a compound role byte-identically through create and read', async () => {
    const created = await service.create({
      name: 'Surveillance Admin',
      email: 'compound@example.com',
      password: 'password123',
      role: 'admin,surveillance',
    });

    expect(created.role).toBe('admin,surveillance');

    const reloaded = await service.findOne(String(created.id));
    expect(reloaded.role).toBe('admin,surveillance');

    const listed = await service.findAll();
    expect(listed.data[0].role).toBe('admin,surveillance');
  });

  it('persists a compound role written through update and reads it back unchanged', async () => {
    const created = await service.create({
      name: 'Promoted User',
      email: 'promoted@example.com',
      password: 'password123',
      role: 'user',
    });

    const updated = await service.update(String(created.id), {
      role: 'admin,surveillance',
    });
    expect(updated.role).toBe('admin,surveillance');

    const reloaded = await service.findOne(String(created.id));
    expect(reloaded.role).toBe('admin,surveillance');
  });

  it('revokes the target sessions when an update changes the role', async () => {
    const created = await service.create({
      name: 'Granted User',
      email: 'granted@example.com',
      password: 'password123',
      role: 'user',
    });
    await db.query(
      'INSERT INTO session (id, "userId", token) VALUES ($1, $2, $3)',
      ['session-grant', created.id, 'grant-token'],
    );
    expect(await countRows('session')).toBe(1);

    await service.update(String(created.id), { role: 'admin,surveillance' });

    expect(await countRows('session')).toBe(0);
  });

  it('leaves sessions intact for an update that does not change the role', async () => {
    const created = await service.create({
      name: 'Renamed User',
      email: 'renamed@example.com',
      password: 'password123',
      role: 'surveillance',
    });
    await db.query(
      'INSERT INTO session (id, "userId", token) VALUES ($1, $2, $3)',
      ['session-keep', created.id, 'keep-token'],
    );

    await service.update(String(created.id), { name: 'Renamed Again' });
    expect(await countRows('session')).toBe(1);

    await service.update(String(created.id), { role: 'surveillance' });
    expect(await countRows('session')).toBe(1);
  });

  async function countRows(table: string): Promise<number> {
    const result = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${table}`,
    );
    return Number(result.rows[0].count);
  }
});

describe('user account role schemas', () => {
  it('accepts a compound role and canonicalises it', () => {
    expect(
      createUserSchema.parse({
        name: 'x',
        email: 'A@B.io',
        role: 'admin,surveillance',
      }).role,
    ).toBe('admin,surveillance');

    const reordered = createUserSchema.parse({
      name: 'x',
      email: 'A@B.io',
      role: 'surveillance, admin',
    }).role;
    expect(reordered).toBe('admin,surveillance');
    expect(reordered.includes(' ')).toBe(false);
  });

  it('defaults to user when no role is supplied', () => {
    expect(createUserSchema.parse({ name: 'x', email: 'A@B.io' }).role).toBe(
      'user',
    );
  });

  it('rejects any string carrying a token outside AUTH_ROLES', () => {
    for (const role of ['root', 'admin,root', '', 'surveillance-lead']) {
      expect(() =>
        createUserSchema.parse({ name: 'x', email: 'A@B.io', role }),
      ).toThrow();
    }
  });

  it('accepts an optional role on updateUserSchema and omits it when absent', () => {
    expect(updateUserSchema.parse({ role: 'surveillance' }).role).toBe(
      'surveillance',
    );
    expect(Object.keys(updateUserSchema.parse({ name: 'x' }))).not.toContain(
      'role',
    );
  });

  it('keeps self-escalation closed — updateMeSchema has no role key', () => {
    expect(Object.keys(updateMeSchema.parse({ name: 'x' }))).not.toContain(
      'role',
    );
    expect(
      Object.keys(
        updateMeSchema.parse({ name: 'x', role: 'admin' } as never),
      ),
    ).not.toContain('role');
  });
});
