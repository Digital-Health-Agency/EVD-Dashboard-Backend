import { registerAs } from '@nestjs/config';

export const DEFAULT_AUTH_DATABASE_URL =
  'postgres://postgres:postgres@localhost:5432/evd';
export const DEFAULT_ANALYTICS_DATABASE_URL =
  'postgres://postgres:postgres@localhost:5433/evd_analytics';

export function resolveAuthDatabaseUrl(): string {
  return (
    process.env.AUTH_DATABASE_URL ||
    process.env.DATABASE_URL ||
    DEFAULT_AUTH_DATABASE_URL
  );
}

export function resolveAnalyticsDatabaseUrl(): string {
  return process.env.ANALYTICS_DATABASE_URL || DEFAULT_ANALYTICS_DATABASE_URL;
}

export const envConfig = registerAs('env', () => {
  const authDatabaseUrl = resolveAuthDatabaseUrl();
  const analyticsDatabaseUrl = resolveAnalyticsDatabaseUrl();

  return {
    authDatabaseUrl,
    analyticsDatabaseUrl,
    databaseUrl: authDatabaseUrl,
    skipDbSchemaSync: process.env.SKIP_DB_SCHEMA_SYNC === 'true',
    port: parseInt(process.env.PORT || '4000', 10),
    betterAuthSecret: process.env.BETTER_AUTH_SECRET || 'dev-secret-change-me',
    trustedOrigins: (
      process.env.TRUSTED_ORIGINS ||
      'http://localhost:3000,http://localhost:3001,http://localhost:3002,http://localhost:3003'
    ).split(','),
    cookieDomain: process.env.COOKIE_DOMAIN || 'localhost',
    uploadDir: process.env.UPLOAD_DIR || 'uploads',
  };
});
