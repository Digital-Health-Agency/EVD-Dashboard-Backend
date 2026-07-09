import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { UserController } from './user.controller.js';
import {
  AuthAccount,
  AuthAccountSchema,
  AuthSession,
  AuthSessionSchema,
  AuthUser,
  AuthUserSchema,
} from './user-account.schema.js';
import { UserAccountService } from './user-account.service.js';
import {
  BetterAuthUserInviteService,
  USER_INVITE_SENDER,
} from './user-invite.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AuthUser.name, schema: AuthUserSchema },
      { name: AuthAccount.name, schema: AuthAccountSchema },
      { name: AuthSession.name, schema: AuthSessionSchema },
    ]),
  ],
  controllers: [UserController],
  providers: [
    UserAccountService,
    BetterAuthUserInviteService,
    {
      provide: USER_INVITE_SENDER,
      useExisting: BetterAuthUserInviteService,
    },
  ],
  exports: [UserAccountService],
})
export class UserModule {}
