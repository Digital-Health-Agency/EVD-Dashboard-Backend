import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes, randomUUID, scrypt } from 'node:crypto';

import { DatabaseService } from '../../database/database.module.js';
import type {
  AuthRole,
  CreateUserDto,
  UpdateMeDto,
  UpdateUserDto,
} from './dto/user-account.dto.js';
import type { AuthUserRecord, StoredAuthId } from './user-account.schema.js';
import {
  USER_INVITE_SENDER,
  type UserInviteSender,
} from './user-invite.service.js';
import type { RequestAppId } from '../../common/app-id.js';

const allowedRoles = new Set<AuthRole>(['user', 'admin']);

@Injectable()
export class UserAccountService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(USER_INVITE_SENDER)
    private readonly inviteSender: UserInviteSender,
  ) {}

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private normalizeRole(role?: string): AuthRole {
    if (role && allowedRoles.has(role as AuthRole)) {
      return role as AuthRole;
    }
    return 'user';
  }

  private async hashPassword(password: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const salt = randomBytes(16).toString('hex');
      scrypt(
        password.normalize('NFKC'),
        salt,
        64,
        { N: 16384, r: 16, p: 1, maxmem: 128 * 16384 * 16 * 2 },
        (err, derived) => {
          if (err) return reject(err);
          resolve(`${salt}:${derived.toString('hex')}`);
        },
      );
    });
  }

  private serialize(user: AuthUserRecord): Record<string, unknown> {
    const email = user.email ? this.normalizeEmail(user.email) : '';
    const status = user.banned ? 'inactive' : 'active';
    return {
      id: String(user.id),
      name: user.name ?? '',
      fullName: user.name ?? '',
      email,
      emailVerified: Boolean(user.emailVerified),
      image: user.image ?? null,
      role: this.normalizeRole(user.role),
      status,
      banned: Boolean(user.banned),
      banReason: user.banReason ?? null,
      banExpires: user.banExpires ?? null,
      createdAt: user.createdAt?.toISOString(),
      updatedAt: user.updatedAt?.toISOString(),
    };
  }

  private async getUserRecord(id: string): Promise<AuthUserRecord> {
    const result = await this.db.query<AuthUserRecord>(
      'SELECT * FROM "user" WHERE id = $1',
      [id],
    );
    const user = result.rows[0];
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }

  async create(
    dto: CreateUserDto,
    appId: RequestAppId = 'unknown',
  ): Promise<Record<string, unknown>> {
    const email = this.normalizeEmail(dto.email);
    const existing = await this.db.query<AuthUserRecord>(
      'SELECT * FROM "user" WHERE email = $1',
      [email],
    );
    if (existing.rows[0])
      throw new Error('User with this email already exists');

    const userId = randomUUID();
    const role = this.normalizeRole(dto.role);
    const user = await this.db.transaction(async (client) => {
      const created = await client.query<AuthUserRecord>(
        `
          INSERT INTO "user" (
            id, name, email, "emailVerified", image, role, banned,
            "banReason", "banExpires"
          )
          VALUES ($1, $2, $3, true, null, $4, false, null, null)
          RETURNING *
        `,
        [userId, dto.name.trim(), email, role],
      );

      if (dto.password) {
        await client.query(
          `
            INSERT INTO account (
              id, "userId", "accountId", "providerId", password
            )
            VALUES ($1, $2, $2, 'credential', $3)
          `,
          [randomUUID(), userId, await this.hashPassword(dto.password)],
        );
      }

      return created.rows[0];
    });

    if (!dto.password) {
      await this.inviteSender.sendInvite({ appId, email });
    }

    return this.serialize(user);
  }

  async findAll(
    page = 1,
    limit = 20,
    search?: string,
    status?: string,
  ): Promise<{
    data: Record<string, unknown>[];
    total: number;
    page: number;
    limit: number;
  }> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (search) {
      values.push(`%${search}%`);
      conditions.push(
        `(name ILIKE $${values.length} OR email ILIKE $${values.length} OR role ILIKE $${values.length})`,
      );
    }
    if (status === 'active') conditions.push('banned = false');
    if (status === 'inactive') conditions.push('banned = true');
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.db.query<AuthUserRecord>(
        `SELECT * FROM "user" ${where} ORDER BY "createdAt" DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, limit, offset],
      ),
      this.db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM "user" ${where}`,
        values,
      ),
    ]);

    return {
      data: data.rows.map((user) => this.serialize(user)),
      total: Number(total.rows[0].count),
      page,
      limit,
    };
  }

  async findOne(id: string): Promise<Record<string, unknown>> {
    return this.serialize(await this.getUserRecord(id));
  }

  async findMe(id: string): Promise<Record<string, unknown>> {
    return this.findOne(id);
  }

  async updateMe(
    id: string,
    dto: UpdateMeDto,
  ): Promise<Record<string, unknown>> {
    const current = await this.getUserRecord(id);
    const updated = await this.db.query<AuthUserRecord>(
      `
        UPDATE "user"
        SET name = $2, image = $3, "updatedAt" = now()
        WHERE id = $1
        RETURNING *
      `,
      [
        id,
        dto.name !== undefined ? dto.name.trim() : current.name,
        dto.image !== undefined ? dto.image?.trim() || null : current.image,
      ],
    );
    return this.serialize(updated.rows[0]);
  }

  async update(
    id: string,
    dto: UpdateUserDto,
  ): Promise<Record<string, unknown>> {
    const current = await this.getUserRecord(id);
    if (dto.email !== undefined) {
      const email = this.normalizeEmail(dto.email);
      const existing = await this.db.query<AuthUserRecord>(
        'SELECT * FROM "user" WHERE email = $1 AND id <> $2',
        [email, id],
      );
      if (existing.rows[0])
        throw new Error('User with this email already exists');
    }

    const banned =
      dto.banned !== undefined ? dto.banned : Boolean(current.banned);
    const result = await this.db.query<AuthUserRecord>(
      `
        UPDATE "user"
        SET
          name = $2,
          email = $3,
          role = $4,
          banned = $5,
          "banReason" = $6,
          "banExpires" = $7,
          "updatedAt" = now()
        WHERE id = $1
        RETURNING *
      `,
      [
        id,
        dto.name !== undefined ? dto.name.trim() : current.name,
        dto.email !== undefined
          ? this.normalizeEmail(dto.email)
          : current.email,
        dto.role !== undefined ? this.normalizeRole(dto.role) : current.role,
        banned,
        dto.banned === false ? null : (current.banReason ?? null),
        dto.banned === false ? null : (current.banExpires ?? null),
      ],
    );
    return this.serialize(result.rows[0]);
  }

  async deactivate(
    id: string,
    reason?: string,
  ): Promise<Record<string, unknown>> {
    const result = await this.db.query<AuthUserRecord>(
      `
        UPDATE "user"
        SET banned = true,
          "banReason" = $2,
          "banExpires" = null,
          "updatedAt" = now()
        WHERE id = $1
        RETURNING *
      `,
      [id, reason || 'Account deactivated'],
    );
    const user = result.rows[0];
    if (!user) throw new NotFoundException(`User ${id} not found`);
    await this.revokeSessions(id);
    return this.serialize(user);
  }

  async activate(id: string): Promise<Record<string, unknown>> {
    const result = await this.db.query<AuthUserRecord>(
      `
        UPDATE "user"
        SET banned = false,
          "banReason" = null,
          "banExpires" = null,
          "updatedAt" = now()
        WHERE id = $1
        RETURNING *
      `,
      [id],
    );
    const user = result.rows[0];
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return this.serialize(user);
  }

  async setPassword(
    id: string,
    password: string,
  ): Promise<Record<string, unknown>> {
    const user = await this.getUserRecord(id);
    const hashedPassword = await this.hashPassword(password);
    await this.db.query(
      `
        INSERT INTO account (
          id, "userId", "accountId", "providerId", password
        )
        VALUES ($1, $2, $2, 'credential', $3)
        ON CONFLICT ("providerId", "userId")
        DO UPDATE SET password = EXCLUDED.password, "updatedAt" = now()
      `,
      [randomUUID(), user.id, hashedPassword],
    );
    return this.serialize(user);
  }

  async remove(id: string): Promise<void> {
    const user = await this.getUserRecord(id);
    await this.db.transaction(async (client) => {
      await client.query('DELETE FROM session WHERE "userId" = $1', [user.id]);
      await client.query(
        'DELETE FROM account WHERE "userId" = $1 OR "accountId" = $1',
        [user.id],
      );
      await client.query('DELETE FROM "user" WHERE id = $1', [user.id]);
    });
  }

  private async revokeSessions(id: StoredAuthId): Promise<void> {
    await this.db.query('DELETE FROM session WHERE "userId" = $1', [id]);
  }
}
