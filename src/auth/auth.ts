import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import { admin, bearer } from 'better-auth/plugins';
import { MongoClient } from 'mongodb';

import { sendPasswordResetEmail } from './send-password-reset-email.js';
import { buildResetPasswordUrl } from './reset-link.js';
import { getRequestAppIdFromHeaders } from '../common/app-id.js';

const client = new MongoClient(
  process.env.MONGODB_URI || 'mongodb://localhost:27017/evd',
);
const db = client.db();

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
  database: mongodbAdapter(db, { client }),
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
