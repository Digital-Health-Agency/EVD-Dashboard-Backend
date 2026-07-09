import type { AuthRole } from './dto/user-account.dto.js';

export type StoredAuthId = string;

export interface AuthUserRecord {
  id: StoredAuthId;
  name?: string;
  email?: string;
  emailVerified?: boolean;
  image?: string | null;
  role?: AuthRole | string;
  banned?: boolean | null;
  banReason?: string | null;
  banExpires?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface AuthAccountRecord {
  id: StoredAuthId;
  userId: StoredAuthId;
  accountId: StoredAuthId;
  providerId: string;
  password?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface AuthSessionRecord {
  id: StoredAuthId;
  userId: StoredAuthId;
  token?: string | null;
  expiresAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}
