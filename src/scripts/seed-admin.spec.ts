import { describe, it, expect, afterAll, beforeAll, beforeEach } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, ObjectId } from 'mongodb';

import { upsertAdminAuthUser } from './seed-admin.js';

describe('seed-admin script', () => {
  let mongod: MongoMemoryServer;
  let client: MongoClient;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    client = new MongoClient(mongod.getUri());
    await client.connect();
  });

  afterAll(async () => {
    await client.close();
    await mongod.stop();
  });

  beforeEach(async () => {
    const db = client.db();
    await db.collection('user').deleteMany({});
    await db.collection('account').deleteMany({});
  });

  it('creates a credential account for an existing admin user without one', async () => {
    const db = client.db();
    const userId = new ObjectId();
    await db.collection('user').insertOne({
      _id: userId,
      name: 'Existing Admin',
      email: 'admin@example.com',
      emailVerified: true,
      role: 'user',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await upsertAdminAuthUser(db, {
      fullName: 'Existing Admin',
      email: 'ADMIN@example.com',
      password: 'password123',
    });

    const user = await db.collection('user').findOne({ _id: userId });
    const account = await db.collection('account').findOne({ userId });

    expect(user?.role).toBe('admin');
    expect(user?.email).toBe('admin@example.com');
    expect(account).toMatchObject({
      userId,
      accountId: userId,
      providerId: 'credential',
    });
    expect(account?.password).toEqual(
      expect.stringMatching(/^[a-f0-9]+:[a-f0-9]+$/),
    );
  });
});
