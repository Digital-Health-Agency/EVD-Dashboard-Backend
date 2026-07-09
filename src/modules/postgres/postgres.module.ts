import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import {
  POSTGRES_APP_POOL,
  POSTGRES_APP_SERVICE,
  POSTGRES_DATA_POOL,
  POSTGRES_DATA_SERVICE,
} from './postgres.constants.js';
import { PostgresService } from './postgres.service.js';

function createPool(config: ConfigService, dbName: string) {
  return new Pool({
    host: config.get('POSTGRES_HOST', 'localhost'),
    port: Number(config.get('POSTGRES_PORT', 5432)),
    database: dbName,
    user: config.get('POSTGRES_USER', 'warehouse'),
    password: config.get('POSTGRES_PASSWORD', ''),
    max: Number(config.get('POSTGRES_MAX_CLIENTS', 10)),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });
}

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: POSTGRES_DATA_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createPool(config, config.get('POSTGRES_DB', 'evd_raw')),
    },
    {
      provide: POSTGRES_APP_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createPool(config, config.get('POSTGRES_APP_DB', 'evd_app')),
    },
    {
      provide: POSTGRES_DATA_SERVICE,
      inject: [POSTGRES_DATA_POOL],
      useFactory: (pool: Pool) => new PostgresService(pool),
    },
    {
      provide: POSTGRES_APP_SERVICE,
      inject: [POSTGRES_APP_POOL],
      useFactory: (pool: Pool) => new PostgresService(pool),
    },
  ],
  exports: [POSTGRES_DATA_SERVICE, POSTGRES_APP_SERVICE],
})
export class PostgresModule {}
