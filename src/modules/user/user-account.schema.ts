import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';
import { ObjectId } from 'mongodb';

import { authRoleValues, type AuthRole } from './dto/user-account.dto.js';

export type StoredAuthId = ObjectId | string;

export type AuthUserDocument = HydratedDocument<AuthUser>;
export type AuthAccountDocument = HydratedDocument<AuthAccount>;
export type AuthSessionDocument = HydratedDocument<AuthSession>;

@Schema({ collection: 'user', strict: false, _id: false })
export class AuthUser {
  @Prop({ type: SchemaTypes.Mixed, required: true })
  _id!: StoredAuthId;

  @Prop({ trim: true })
  name?: string;

  @Prop({ lowercase: true, trim: true })
  email?: string;

  @Prop({ default: false })
  emailVerified?: boolean;

  @Prop({ type: String })
  image?: string | null;

  @Prop({
    type: String,
    enum: authRoleValues,
    trim: true,
    default: 'user',
  })
  role?: AuthRole;

  @Prop({ type: Boolean, default: false })
  banned?: boolean | null;

  @Prop({ type: String })
  banReason?: string | null;

  @Prop({ type: Date })
  banExpires?: Date | null;

  @Prop({ type: Date })
  createdAt?: Date;

  @Prop({ type: Date })
  updatedAt?: Date;
}

export const AuthUserSchema = SchemaFactory.createForClass(AuthUser);
AuthUserSchema.index({ email: 1 }, { unique: true, sparse: true });

@Schema({ collection: 'account', strict: false, _id: false })
export class AuthAccount {
  @Prop({ type: SchemaTypes.Mixed, required: true })
  _id!: StoredAuthId;

  @Prop({ type: SchemaTypes.Mixed, required: true })
  userId!: StoredAuthId;

  @Prop({ type: SchemaTypes.Mixed, required: true })
  accountId!: StoredAuthId;

  @Prop({ required: true, trim: true })
  providerId!: string;

  @Prop({ type: String })
  password?: string;

  @Prop({ type: Date })
  createdAt?: Date;

  @Prop({ type: Date })
  updatedAt?: Date;
}

export const AuthAccountSchema = SchemaFactory.createForClass(AuthAccount);
AuthAccountSchema.index({ providerId: 1, userId: 1 });

@Schema({ collection: 'session', strict: false, _id: false })
export class AuthSession {
  @Prop({ type: SchemaTypes.Mixed, required: true })
  _id!: StoredAuthId;

  @Prop({ type: SchemaTypes.Mixed, required: true })
  userId!: StoredAuthId;

  @Prop({ type: String })
  token?: string;

  @Prop({ type: Date })
  expiresAt?: Date;

  @Prop({ type: Date })
  createdAt?: Date;

  @Prop({ type: Date })
  updatedAt?: Date;
}

export const AuthSessionSchema = SchemaFactory.createForClass(AuthSession);
AuthSessionSchema.index({ userId: 1 });
