import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_ANALYTICS_DATABASE_URL,
  DEFAULT_AUTH_DATABASE_URL,
  resolveAnalyticsDatabaseUrl,
  resolveAuthDatabaseUrl,
} from './env.config.js';

describe('env.config', () => {
  const trackedEnv = [
    'DATABASE_URL',
    'AUTH_DATABASE_URL',
    'ANALYTICS_DATABASE_URL',
  ] as const;
  let previousEnv: Record<(typeof trackedEnv)[number], string | undefined>;

  beforeEach(() => {
    previousEnv = Object.fromEntries(
      trackedEnv.map((key) => [key, process.env[key]]),
    ) as Record<(typeof trackedEnv)[number], string | undefined>;
    for (const key of trackedEnv) delete process.env[key];
  });

  afterEach(() => {
    for (const key of trackedEnv) {
      const previous = previousEnv[key];
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    }
  });

  describe('resolveAnalyticsDatabaseUrl', () => {
    it('defaults to the local evd_raw database on port 5432', () => {
      const url = new URL(resolveAnalyticsDatabaseUrl());

      expect(url.pathname.replace(/^\//, '')).toBe('evd_raw');
      expect(url.port).toBe('5432');
      expect(url.hostname).toBe('localhost');
    });

    it('exposes the same target through DEFAULT_ANALYTICS_DATABASE_URL', () => {
      const url = new URL(DEFAULT_ANALYTICS_DATABASE_URL);

      expect(url.pathname.replace(/^\//, '')).toBe('evd_raw');
      expect(url.port).toBe('5432');
    });

    it('does not default to the retired warehouse database on 5433', () => {
      const url = new URL(resolveAnalyticsDatabaseUrl());

      expect(url.pathname.replace(/^\//, '')).not.toBe('warehouse');
      expect(url.port).not.toBe('5433');
    });

    it('returns an explicit ANALYTICS_DATABASE_URL verbatim', () => {
      const explicit = 'postgres://reader:secret@warehouse.internal:6543/gold';
      process.env.ANALYTICS_DATABASE_URL = explicit;

      expect(resolveAnalyticsDatabaseUrl()).toBe(explicit);
    });

    it('ignores AUTH_DATABASE_URL and DATABASE_URL when falling back', () => {
      process.env.AUTH_DATABASE_URL =
        'postgres://auth:pass@localhost:5432/auth_test';
      process.env.DATABASE_URL =
        'postgres://legacy:pass@localhost:5432/legacy_test';

      expect(resolveAnalyticsDatabaseUrl()).toBe(
        DEFAULT_ANALYTICS_DATABASE_URL,
      );
    });
  });

  describe('resolveAuthDatabaseUrl', () => {
    it('is unaffected by the analytics default moving', () => {
      expect(resolveAuthDatabaseUrl()).toBe(DEFAULT_AUTH_DATABASE_URL);

      const url = new URL(resolveAuthDatabaseUrl());
      expect(url.pathname.replace(/^\//, '')).toBe('evd');
    });

    it('is unaffected by an explicit ANALYTICS_DATABASE_URL', () => {
      process.env.ANALYTICS_DATABASE_URL =
        'postgres://reader:secret@warehouse.internal:6543/gold';

      expect(resolveAuthDatabaseUrl()).toBe(DEFAULT_AUTH_DATABASE_URL);
    });

    it('still prefers AUTH_DATABASE_URL, then DATABASE_URL', () => {
      process.env.DATABASE_URL =
        'postgres://legacy:pass@localhost:5432/legacy_test';
      expect(resolveAuthDatabaseUrl()).toBe(process.env.DATABASE_URL);

      process.env.AUTH_DATABASE_URL =
        'postgres://auth:pass@localhost:5432/auth_test';
      expect(resolveAuthDatabaseUrl()).toBe(process.env.AUTH_DATABASE_URL);
    });
  });
});
