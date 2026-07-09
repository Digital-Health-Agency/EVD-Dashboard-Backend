import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes, scrypt } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { Model } from 'mongoose';

import type {
  AuthRole,
  CreateUserDto,
  UpdateMeDto,
  UpdateUserDto,
} from './dto/user-account.dto.js';
import {
  AuthAccount,
  AuthSession,
  AuthUser,
  type AuthAccountDocument,
  type AuthSessionDocument,
  type AuthUserDocument,
  type StoredAuthId,
} from './user-account.schema.js';
import {
  USER_INVITE_SENDER,
  type UserInviteSender,
} from './user-invite.service.js';
import type { RequestAppId } from '../../common/app-id.js';

const allowedRoles = new Set<AuthRole>(['user', 'admin']);

interface AuthUserRecord {
  _id: StoredAuthId;
  name?: string;
  email?: string;
  emailVerified?: boolean;
  image?: string | null;
  role?: string;
  banned?: boolean | null;
  banReason?: string | null;
  banExpires?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

@Injectable()
export class UserAccountService {
  constructor(
    @InjectModel(AuthUser.name)
    private readonly authUserModel: Model<AuthUserDocument>,
    @InjectModel(AuthAccount.name)
    private readonly authAccountModel: Model<AuthAccountDocument>,
    @InjectModel(AuthSession.name)
    private readonly authSessionModel: Model<AuthSessionDocument>,
    @Inject(USER_INVITE_SENDER)
    private readonly inviteSender: UserInviteSender,
  ) {}

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private idCandidates(id: string | StoredAuthId): StoredAuthId[] {
    if (id instanceof ObjectId) return [id, id.toHexString()];
    const raw = String(id);
    return ObjectId.isValid(raw) ? [raw, new ObjectId(raw)] : [raw];
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
      id: String(user._id),
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
    const user = await this.authUserModel
      .findOne({ _id: { $in: this.idCandidates(id) } })
      .lean<AuthUserRecord>()
      .exec();
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }

  async create(
    dto: CreateUserDto,
    appId: RequestAppId = 'unknown',
  ): Promise<Record<string, unknown>> {
    const email = this.normalizeEmail(dto.email);
    const existing = await this.authUserModel.findOne({ email }).lean().exec();
    if (existing) throw new Error('User with this email already exists');

    const now = new Date();
    const userId = new ObjectId();
    const role = this.normalizeRole(dto.role);
    const user: AuthUserRecord = {
      _id: userId,
      name: dto.name.trim(),
      email,
      emailVerified: true,
      image: null,
      role,
      banned: false,
      banReason: null,
      banExpires: null,
      createdAt: now,
      updatedAt: now,
    };

    await this.authUserModel.create(user);
    if (dto.password) {
      await this.authAccountModel.create({
        _id: new ObjectId(),
        userId,
        accountId: userId,
        providerId: 'credential',
        password: await this.hashPassword(dto.password),
        createdAt: now,
        updatedAt: now,
      });
    } else {
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
    const filter: Record<string, unknown> = {};
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { role: { $regex: search, $options: 'i' } },
      ];
    }
    if (status === 'active') filter.banned = { $ne: true };
    if (status === 'inactive') filter.banned = true;

    const [data, total] = await Promise.all([
      this.authUserModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<AuthUserRecord[]>()
        .exec(),
      this.authUserModel.countDocuments(filter).exec(),
    ]);

    return {
      data: data.map((user) => this.serialize(user)),
      total,
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
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.name !== undefined) set.name = dto.name.trim();
    if (dto.image !== undefined) set.image = dto.image?.trim() || null;

    const updated = await this.authUserModel
      .findOneAndUpdate(
        { _id: { $in: this.idCandidates(id) } },
        { $set: set },
        { returnDocument: 'after' },
      )
      .lean<AuthUserRecord>()
      .exec();
    if (!updated) throw new NotFoundException(`User ${id} not found`);
    return this.serialize(updated);
  }

  async update(
    id: string,
    dto: UpdateUserDto,
  ): Promise<Record<string, unknown>> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.name !== undefined) set.name = dto.name.trim();
    if (dto.email !== undefined) {
      const email = this.normalizeEmail(dto.email);
      const existing = await this.authUserModel
        .findOne({
          email,
          _id: { $nin: this.idCandidates(id) },
        })
        .lean()
        .exec();
      if (existing) throw new Error('User with this email already exists');
      set.email = email;
    }
    if (dto.role !== undefined) set.role = this.normalizeRole(dto.role);
    if (dto.banned !== undefined) {
      set.banned = dto.banned;
      if (!dto.banned) {
        set.banReason = null;
        set.banExpires = null;
      }
    }

    const updated = await this.authUserModel
      .findOneAndUpdate(
        { _id: { $in: this.idCandidates(id) } },
        { $set: set },
        { returnDocument: 'after' },
      )
      .lean<AuthUserRecord>()
      .exec();
    if (!updated) throw new NotFoundException(`User ${id} not found`);
    return this.serialize(updated);
  }

  async deactivate(
    id: string,
    reason?: string,
  ): Promise<Record<string, unknown>> {
    const updated = await this.authUserModel
      .findOneAndUpdate(
        { _id: { $in: this.idCandidates(id) } },
        {
          $set: {
            banned: true,
            banReason: reason || 'Account deactivated',
            banExpires: null,
            updatedAt: new Date(),
          },
        },
        { returnDocument: 'after' },
      )
      .lean<AuthUserRecord>()
      .exec();
    if (!updated) throw new NotFoundException(`User ${id} not found`);
    await this.revokeSessions(id);
    return this.serialize(updated);
  }

  async activate(id: string): Promise<Record<string, unknown>> {
    const updated = await this.authUserModel
      .findOneAndUpdate(
        { _id: { $in: this.idCandidates(id) } },
        {
          $set: {
            banned: false,
            banReason: null,
            banExpires: null,
            updatedAt: new Date(),
          },
        },
        { returnDocument: 'after' },
      )
      .lean<AuthUserRecord>()
      .exec();
    if (!updated) throw new NotFoundException(`User ${id} not found`);
    return this.serialize(updated);
  }

  async setPassword(
    id: string,
    password: string,
  ): Promise<Record<string, unknown>> {
    const user = await this.getUserRecord(id);
    const now = new Date();
    await this.authAccountModel
      .updateOne(
        {
          providerId: 'credential',
          userId: { $in: this.idCandidates(id) },
        },
        {
          $set: {
            password: await this.hashPassword(password),
            updatedAt: now,
          },
          $setOnInsert: {
            _id: new ObjectId(),
            userId: user._id,
            accountId: user._id,
            providerId: 'credential',
            createdAt: now,
          },
        },
        { upsert: true },
      )
      .exec();
    return this.serialize(user);
  }

  async remove(id: string): Promise<void> {
    const user = await this.getUserRecord(id);
    const candidates = this.idCandidates(id);
    await Promise.all([
      this.authUserModel.deleteOne({ _id: user._id }).exec(),
      this.authAccountModel
        .deleteMany({
          $or: [
            { userId: { $in: candidates } },
            { accountId: { $in: candidates } },
          ],
        })
        .exec(),
      this.authSessionModel.deleteMany({ userId: { $in: candidates } }).exec(),
    ]);
  }

  private async revokeSessions(id: string): Promise<void> {
    await this.authSessionModel
      .deleteMany({ userId: { $in: this.idCandidates(id) } })
      .exec();
  }
}
