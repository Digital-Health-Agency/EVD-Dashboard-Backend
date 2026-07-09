import { describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { Pool } from 'pg';

import { envConfig } from '../config/env.config.js';
import { DatabaseModule, POSTGRES_POOL } from './database.module.js';

describe('DatabaseModule', () => {
  it('provides a Postgres pool using DATABASE_URL', async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/evd_test';

    try {
      const moduleRef = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            load: [envConfig],
          }),
          DatabaseModule,
        ],
      }).compile();

      const pool = moduleRef.get<Pool>(POSTGRES_POOL);
      expect(pool).toBeInstanceOf(Pool);

      await moduleRef.close();
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  });
});
