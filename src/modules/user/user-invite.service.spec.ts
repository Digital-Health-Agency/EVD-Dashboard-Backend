import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { requestPasswordResetMock } = vi.hoisted(() => ({
  requestPasswordResetMock: vi.fn().mockResolvedValue({ status: true }),
}));

vi.mock('../../auth/auth.js', () => ({
  auth: {
    api: {
      requestPasswordReset: requestPasswordResetMock,
    },
  },
}));

import { BetterAuthUserInviteService } from './user-invite.service.js';

interface PasswordResetCall {
  body: {
    email: string;
    redirectTo: string;
  };
  headers: Headers;
  request: Request;
}

describe('BetterAuthUserInviteService', () => {
  const env = process.env;
  let service: BetterAuthUserInviteService;

  beforeEach(() => {
    service = new BetterAuthUserInviteService();
    requestPasswordResetMock.mockClear();
    vi.stubEnv('DASHBOARD_APP_URL', 'https://dashboard.evd.local');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    process.env = env;
  });

  it('passes dashboard app id with the EVD app header', async () => {
    await service.sendInvite({ email: 'user@example.com', appId: 'dashboard' });

    expect(requestPasswordResetMock).toHaveBeenCalledTimes(1);
    const call = requestPasswordResetMock.mock.calls[0]?.[0] as
      | PasswordResetCall
      | undefined;
    expect(call).toBeDefined();
    if (!call) return;
    expect(call.body).toEqual({
      email: 'user@example.com',
      redirectTo: 'https://dashboard.evd.local/reset-password',
    });
    expect(call.headers.get('x-evd-app-id')).toBe('dashboard');
    expect(call.request).toBeInstanceOf(Request);
    expect(call.request.headers.get('x-evd-app-id')).toBe('dashboard');
  });
});
