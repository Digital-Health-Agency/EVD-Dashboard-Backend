import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { Pool } from 'pg';

import { envConfig } from '../config/env.config.js';
import {
  ANALYTICS_POSTGRES_POOL,
  AUTH_POSTGRES_POOL,
  DatabaseModule,
  POSTGRES_POOL,
} from './database.module.js';

describe('DatabaseModule', () => {
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

  it('provides separate auth and analytics Postgres pools', async () => {
    process.env.DATABASE_URL =
      'postgres://legacy:pass@localhost:5432/legacy_test';
    process.env.AUTH_DATABASE_URL =
      'postgres://auth:pass@localhost:5432/auth_test';
    process.env.ANALYTICS_DATABASE_URL =
      'postgres://analytics:pass@localhost:5433/analytics_test';

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          isGlobal: true,
          load: [envConfig],
        }),
        DatabaseModule,
      ],
    }).compile();

    try {
      const authPool = moduleRef.get<Pool>(AUTH_POSTGRES_POOL);
      const analyticsPool = moduleRef.get<Pool>(ANALYTICS_POSTGRES_POOL);
      const legacyPool = moduleRef.get<Pool>(POSTGRES_POOL);

      expect(authPool).toBeInstanceOf(Pool);
      expect(analyticsPool).toBeInstanceOf(Pool);
      expect(legacyPool).toBe(authPool);
      expect(authPool.options.connectionString).toBe(
        process.env.AUTH_DATABASE_URL,
      );
      expect(analyticsPool.options.connectionString).toBe(
        process.env.ANALYTICS_DATABASE_URL,
      );
    } finally {
      await moduleRef.close();
    }
  });
});
