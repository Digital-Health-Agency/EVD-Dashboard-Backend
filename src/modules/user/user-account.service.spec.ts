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
import {
  MongooseModule,
  getConnectionToken,
  getModelToken,
} from '@nestjs/mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Model } from 'mongoose';
import { UserModule } from './user.module.js';
import { UserAccountService } from './user-account.service.js';
import {
  USER_INVITE_SENDER,
  type UserInviteSender,
} from './user-invite.service.js';

describe('UserAccountService', () => {
  let service: UserAccountService;
  let connection: Connection;
  let mongod: MongoMemoryServer;
  let module: TestingModule;
  let inviteSender: {
    sendInvite: ReturnType<typeof vi.fn>;
  };

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();

    inviteSender = {
      sendInvite: vi.fn().mockResolvedValue(undefined),
    };

    module = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(mongod.getUri()), UserModule],
    })
      .overrideProvider(USER_INVITE_SENDER)
      .useValue(inviteSender satisfies UserInviteSender)
      .compile();

    service = module.get<UserAccountService>(UserAccountService);
    connection = module.get<Connection>(getConnectionToken());
  });

  afterAll(async () => {
    await module.close();
    await mongod.stop();
  });

  beforeEach(async () => {
    await connection.db.collection('user').deleteMany({});
    await connection.db.collection('account').deleteMany({});
    await connection.db.collection('session').deleteMany({});
    inviteSender.sendInvite.mockClear();
  });

  it('registers Better Auth collections as user module mongoose models', () => {
    const authUserModel = module.get<Model<unknown>>(
      getModelToken('AuthUser'),
      { strict: false },
    );
    const authAccountModel = module.get<Model<unknown>>(
      getModelToken('AuthAccount'),
      { strict: false },
    );
    const authSessionModel = module.get<Model<unknown>>(
      getModelToken('AuthSession'),
      { strict: false },
    );

    expect(authUserModel.collection.name).toBe('user');
    expect(authAccountModel.collection.name).toBe('account');
    expect(authSessionModel.collection.name).toBe('session');
  });

  it('registers only Better Auth collections as user module mongoose models', () => {
    expect(() =>
      module.get<Model<unknown>>(getModelToken('Member'), { strict: false }),
    ).toThrow();
  });

  it('rejects auth users with roles outside the simplified auth role enum', async () => {
    const authUserModel = module.get<Model<unknown>>(
      getModelToken('AuthUser'),
      { strict: false },
    );

    await expect(
      authUserModel.create({
        _id: 'invalid-role-user',
        name: 'Invalid Role',
        email: 'invalid-role@example.com',
        role: 'operator',
      }),
    ).rejects.toThrow(/role/i);
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
    expect(await connection.db.collection('account').countDocuments()).toBe(1);
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
    expect(await connection.db.collection('account').countDocuments()).toBe(0);
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

    const updated = await service.updateMe(created.id, {
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

    const updated = await service.updateMe(created.id, {
      image: '/uploads/profile/jane.jpg',
    });
    expect(updated.image).toBe('/uploads/profile/jane.jpg');

    const removed = await service.updateMe(created.id, {
      image: null,
    });
    expect(removed.image).toBeNull();
  });

  it('deactivates a user by banning the auth account and revoking sessions', async () => {
    const created = await service.create({
      name: 'Blocked User',
      email: 'blocked@example.com',
      password: 'password123',
      role: 'user',
    });
    await connection.db.collection('session').insertOne({
      userId: created.id,
      token: 'session-token',
    });

    const deactivated = await service.deactivate(created.id, 'requested');

    expect(deactivated.status).toBe('inactive');
    expect(
      await connection.db.collection('session').countDocuments({
        userId: created.id,
      }),
    ).toBe(0);
  });

  it('deletes a login user and its credential/session records only', async () => {
    const created = await service.create({
      name: 'Plain User',
      email: 'plain@example.com',
      password: 'password123',
      role: 'user',
    });
    await connection.db.collection('session').insertOne({
      userId: created.id,
      token: 'session-token',
    });

    await service.remove(created.id);

    expect(await connection.db.collection('user').countDocuments()).toBe(0);
    expect(await connection.db.collection('account').countDocuments()).toBe(0);
    expect(await connection.db.collection('session').countDocuments()).toBe(0);
  });
});
