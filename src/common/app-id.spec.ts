import { describe, expect, it } from 'vitest';
import { getRequestAppId, getRequestAppIdFromHeaders } from './app-id.js';

describe('getRequestAppId', () => {
  it('returns a known app id from the request header', () => {
    expect(
      getRequestAppId({
        get: (name: string) =>
          name === 'x-evd-app-id' ? 'dashboard' : undefined,
      }),
    ).toBe('dashboard');
  });

  it('returns unknown for missing or unsupported app ids', () => {
    expect(getRequestAppId({ get: () => undefined })).toBe('unknown');
    expect(getRequestAppId({ get: () => 'admin' })).toBe('unknown');
    expect(getRequestAppId({ get: () => 'other-platform' })).toBe('unknown');
  });
});

describe('getRequestAppIdFromHeaders', () => {
  it('returns a known app id from request headers', () => {
    const headers = new Headers({ 'x-evd-app-id': 'dashboard' });
    expect(getRequestAppIdFromHeaders(headers)).toBe('dashboard');
  });

  it('returns unknown when headers are missing or app id is absent', () => {
    expect(getRequestAppIdFromHeaders(undefined)).toBe('unknown');
    expect(getRequestAppIdFromHeaders(new Headers())).toBe('unknown');
  });
});
