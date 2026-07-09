import { Injectable } from '@nestjs/common';

import { auth } from '../../auth/auth.js';
import { resolveResetPasswordBaseUrl } from '../../auth/reset-link.js';
import { APP_ID_HEADER, type RequestAppId } from '../../common/app-id.js';

export const USER_INVITE_SENDER = Symbol('USER_INVITE_SENDER');

export interface UserInviteSender {
  sendInvite(params: { email: string; appId: RequestAppId }): Promise<void>;
}

@Injectable()
export class BetterAuthUserInviteService implements UserInviteSender {
  async sendInvite(params: {
    email: string;
    appId: RequestAppId;
  }): Promise<void> {
    const redirectUrl = new URL(
      '/reset-password',
      resolveResetPasswordBaseUrl(params.appId),
    ).toString();

    const headers = new Headers({ [APP_ID_HEADER]: params.appId });

    await auth.api.requestPasswordReset({
      body: {
        email: params.email,
        redirectTo: redirectUrl,
      },
      headers,
      request: new Request(redirectUrl, { method: 'POST', headers }),
    });
  }
}
