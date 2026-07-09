export const envConfig = {
  mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/evd',
  port: parseInt(process.env.PORT || '4000', 10),
  betterAuthSecret: process.env.BETTER_AUTH_SECRET || 'dev-secret-change-me',
  trustedOrigins: (
    process.env.TRUSTED_ORIGINS ||
    'http://localhost:3000,http://localhost:3001,http://localhost:3002,http://localhost:3003'
  ).split(','),
  cookieDomain: process.env.COOKIE_DOMAIN || 'localhost',
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
};
