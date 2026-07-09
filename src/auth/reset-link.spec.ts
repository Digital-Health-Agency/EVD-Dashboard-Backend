import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildResetPasswordUrl,
  resolveResetPasswordBaseUrl,
} from './reset-link.js';

describe('reset password app links', () => {
  const env = process.env;

  afterEach(() => {
    vi.unstubAllEnvs();
    process.env = env;
  });

  it('maps dashboard reset links to DASHBOARD_APP_URL', () => {
    vi.stubEnv('DASHBOARD_APP_URL', 'https://dashboard.evd.local/');

    expect(resolveResetPasswordBaseUrl('dashboard')).toBe(
      'https://dashboard.evd.local',
    );
  });

  it('falls back to the dashboard URL for missing or unknown app ids', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://evd.local/dashboard/');

    expect(resolveResetPasswordBaseUrl('unknown')).toBe(
      'https://evd.local/dashboard',
    );
  });

  it('builds a direct reset password URL with the expiring token', () => {
    vi.stubEnv('DASHBOARD_APP_URL', 'https://dashboard.evd.local');

    expect(
      buildResetPasswordUrl({ appId: 'dashboard', token: 'abc 123' }),
    ).toBe('https://dashboard.evd.local/reset-password?token=abc+123');
  });
});
