import { Module } from '@nestjs/common';

import { UserController } from './user.controller.js';
import { UserAccountService } from './user-account.service.js';
import {
  BetterAuthUserInviteService,
  USER_INVITE_SENDER,
} from './user-invite.service.js';

@Module({
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
