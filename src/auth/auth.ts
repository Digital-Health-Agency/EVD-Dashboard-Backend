import '../load-env.js';
import { betterAuth } from 'better-auth';
import { kyselyAdapter } from '@better-auth/kysely-adapter';
import { admin, bearer } from 'better-auth/plugins';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';

import { sendPasswordResetEmail } from './send-password-reset-email.js';
import { buildResetPasswordUrl } from './reset-link.js';
import { getRequestAppIdFromHeaders } from '../common/app-id.js';
import { resolveAuthDatabaseUrl } from '../config/env.config.js';

const pool = new Pool({
  connectionString: resolveAuthDatabaseUrl(),
});
const db = new Kysely({
  dialect: new PostgresDialect({ pool }),
});

/** Public origin of this Nest app (Better Auth links, callbacks, auth.api). */
function authBaseUrl(): string {
  const fromEnv =
    process.env.BETTER_AUTH_URL?.replace(/\/$/, '') ||
    process.env.API_PUBLIC_URL?.replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  const port = process.env.PORT || '4000';
  return `http://127.0.0.1:${port}`;
}

export const auth = betterAuth({
  database: kyselyAdapter(db as never, {
    type: 'postgres',
  }),
  baseURL: authBaseUrl(),
  basePath: '/api/auth',
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    resetPasswordTokenExpiresIn: 3600,
    sendResetPassword: async ({ user, token }, request) => {
      const headers = request?.headers;
      const appId = getRequestAppIdFromHeaders(headers);
      const resetUrl = buildResetPasswordUrl({ appId, token });
      const { sent } = await sendPasswordResetEmail({
        to: user.email,
        resetUrl,
      });
      if (!sent) {
        console.info(
          `[AUTH_RESET_LINK] email=${user.email} appId=${appId} resetUrl=${resetUrl} generatedAt=${new Date().toISOString()} (SMTP not configured; link logged instead of sent)`,
        );
      }
    },
  },
  plugins: [
    bearer(),
    admin({
      defaultRole: 'user',
      adminRoles: ['admin'],
    }),
  ],
  trustedOrigins: (
    process.env.TRUSTED_ORIGINS ||
    'http://localhost:3000,http://localhost:4000,http://127.0.0.1:3000,http://127.0.0.1:4000'
  )
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
});

export type Session = typeof auth.$Infer.Session;
