import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, type QueryResultRow } from 'pg';

export const POSTGRES_POOL = Symbol('POSTGRES_POOL');
export const AUTH_POSTGRES_POOL = Symbol('AUTH_POSTGRES_POOL');
export const ANALYTICS_POSTGRES_POOL = Symbol('ANALYTICS_POSTGRES_POOL');

export interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);

  constructor(
    @Inject(AUTH_POSTGRES_POOL) private readonly pool: Pool,
    @Optional() private readonly configService?: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const connectionString =
      this.configService?.get<string>('env.authDatabaseUrl') ??
      this.pool.options.connectionString;
    if (connectionString) {
      this.logger.log(
        `Auth PostgreSQL configured: ${this.formatConnectionDetails(connectionString)}`,
      );
    }

    if (this.configService?.get<boolean>('env.skipDbSchemaSync')) return;
    await this.ensureSchema();
  }

  private formatConnectionDetails(connectionString: string): string {
    try {
      const url = new URL(connectionString);
      const database = url.pathname.replace(/^\//, '') || undefined;
      const port = url.port || '5432';
      return `host=${url.hostname} port=${port} database=${database ?? 'unknown'} user=${url.username || 'unknown'}`;
    } catch {
      return 'connection string configured (unable to parse details)';
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }> {
    return this.pool.query<T>(text, values);
  }

  async transaction<T>(work: (client: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async ensureSchema(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS "user" (
        id text PRIMARY KEY,
        name text,
        email text UNIQUE,
        "emailVerified" boolean NOT NULL DEFAULT false,
        image text,
        role text NOT NULL DEFAULT 'user',
        banned boolean NOT NULL DEFAULT false,
        "banReason" text,
        "banExpires" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS account (
        id text PRIMARY KEY,
        "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        "accountId" text NOT NULL,
        "providerId" text NOT NULL,
        password text,
        "accessToken" text,
        "refreshToken" text,
        "idToken" text,
        "accessTokenExpiresAt" timestamptz,
        "refreshTokenExpiresAt" timestamptz,
        scope text,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        UNIQUE ("providerId", "userId")
      );
      CREATE INDEX IF NOT EXISTS account_provider_user_idx ON account ("providerId", "userId");
      CREATE UNIQUE INDEX IF NOT EXISTS account_provider_user_unique_idx ON account ("providerId", "userId");

      CREATE TABLE IF NOT EXISTS session (
        id text PRIMARY KEY,
        "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        token text UNIQUE,
        "expiresAt" timestamptz,
        "ipAddress" text,
        "userAgent" text,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS session_user_idx ON session ("userId");

      CREATE TABLE IF NOT EXISTS verification (
        id text PRIMARY KEY,
        identifier text NOT NULL,
        value text NOT NULL,
        "expiresAt" timestamptz NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification (identifier);

      CREATE TABLE IF NOT EXISTS media (
        id text PRIMARY KEY,
        filename text NOT NULL,
        "originalName" text NOT NULL,
        "mimeType" text NOT NULL,
        size integer NOT NULL,
        path text NOT NULL,
        "uploadedBy" text,
        tags text[] NOT NULL DEFAULT '{}',
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id text PRIMARY KEY,
        "recipientId" text NOT NULL,
        type text NOT NULL,
        title text NOT NULL,
        message text NOT NULL,
        read boolean NOT NULL DEFAULT false,
        link text,
        "deliveryChannel" text NOT NULL DEFAULT 'inApp',
        "sentAt" timestamptz NOT NULL DEFAULT now(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS notifications_recipient_idx ON notifications ("recipientId", read, "sentAt" DESC);

      CREATE TABLE IF NOT EXISTS mail_logs (
        id text PRIMARY KEY,
        "recipientEmail" text NOT NULL,
        subject text NOT NULL,
        html text,
        text text,
        provider text NOT NULL DEFAULT 'smtp',
        "providerMessageId" text,
        status text NOT NULL DEFAULT 'pending',
        "deliveryStatus" text,
        "deliveredAt" timestamptz,
        error text,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS mail_logs_message_idx ON mail_logs ("providerMessageId");
      CREATE INDEX IF NOT EXISTS mail_logs_recipient_idx ON mail_logs ("recipientEmail", "createdAt" DESC);

      CREATE TABLE IF NOT EXISTS sms_logs (
        id text PRIMARY KEY,
        "recipientPhone" text NOT NULL,
        message text NOT NULL,
        provider text NOT NULL DEFAULT 'africastalking',
        "providerMessageId" text,
        status text NOT NULL DEFAULT 'pending',
        "deliveryStatus" text,
        "deliveredAt" timestamptz,
        error text,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS sms_logs_message_idx ON sms_logs ("providerMessageId");
    `);
  }
}

@Injectable()
class AnalyticsPoolLifecycle implements OnModuleDestroy {
  constructor(
    @Inject(ANALYTICS_POSTGRES_POOL) private readonly analyticsPool: Pool,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.analyticsPool.end();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: AUTH_POSTGRES_POOL,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        new Pool({
          connectionString: configService.getOrThrow<string>(
            'env.authDatabaseUrl',
          ),
        }),
    },
    {
      provide: POSTGRES_POOL,
      useExisting: AUTH_POSTGRES_POOL,
    },
    {
      provide: ANALYTICS_POSTGRES_POOL,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        new Pool({
          connectionString: configService.getOrThrow<string>(
            'env.analyticsDatabaseUrl',
          ),
        }),
    },
    AnalyticsPoolLifecycle,
    DatabaseService,
  ],
  exports: [
    POSTGRES_POOL,
    AUTH_POSTGRES_POOL,
    ANALYTICS_POSTGRES_POOL,
    DatabaseService,
  ],
})
export class DatabaseModule {}
