# DHA EVD Backend Server

Focused NestJS API for the Kenya EVD dashboard stack. The server owns authentication, user administration, media uploads, notifications, mail delivery, SMS delivery logging, dashboard analytics, and health checks.

## Tech Stack

| Layer          | Technology                                      |
| -------------- | ----------------------------------------------- |
| Framework      | NestJS 11                                       |
| Database       | PostgreSQL via `pg` and Kysely                  |
| Authentication | Better Auth + nestjs-better-auth                |
| Validation     | Zod and Nest validation pipes                   |
| Uploads        | Multer disk storage + PostgreSQL media metadata |
| Testing        | Vitest + pg-mem                                 |
| Language       | TypeScript                                      |

## Getting Started

```bash
npm install
cp .env.example .env
npm run start:dev
```

The server listens on `http://localhost:4000` by default.

## Project Structure

```text
src/
  auth/            Better Auth integration and reset-link email helpers
  common/          Shared guards, filters, interceptors, pipes, and app ID helpers
  config/          Environment defaults
  database/        Auth and analytics PostgreSQL pools plus schema bootstrap
  modules/
    user/          Better Auth user/account/session administration
    upload/        Disk upload endpoint and media metadata
    notification/  In-app notification records and inbox APIs
    mail/          Injectable SMTP mail service
    sms/           Injectable SMS service and delivery callback
    analytics/     Read-only gold-mart queries behind /api/analytics/metrics
  scripts/         Standalone scripts such as the admin seeder
  health.controller.ts  Public health check endpoint
```

## API Surface

| Method                  | Path                             | Description                                    |
| ----------------------- | -------------------------------- | ---------------------------------------------- |
| `*`                     | `/api/auth/*`                    | Better Auth routes                             |
| `GET`                   | `/health`                        | Public health check                            |
| `GET`                   | `/api/analytics/metrics`         | Gold-backed dashboard analytics                |
| CRUD                    | `/api/users`                     | Admin user management                          |
| `GET/PATCH/POST/DELETE` | `/api/users/me`                  | Current user profile and deactivation/deletion |
| `POST`                  | `/api/upload`                    | Upload one file and persist media metadata     |
| `GET`                   | `/api/upload`                    | List uploaded media records                    |
| `GET`                   | `/api/upload/:id`                | Fetch one media record                         |
| `DELETE`                | `/api/upload/:id`                | Delete media metadata and disk file            |
| `GET`                   | `/uploads/*`                     | Static uploaded files                          |
| CRUD                    | `/api/notifications`             | Admin notification management                  |
| `GET`                   | `/api/notifications/me`          | Current user's notification inbox              |
| `PATCH`                 | `/api/notifications/me/read-all` | Mark current user's inbox read                 |
| `POST`                  | `/sms/callbacks/delivery`        | SMS provider delivery callback                 |

Use `x-evd-app-id: dashboard` when a request needs dashboard-specific reset-link routing.

## Environment Variables

| Variable                 | Default                                                     | Description                                            |
| ------------------------ | ----------------------------------------------------------- | ------------------------------------------------------ |
| `AUTH_DATABASE_URL`      | `postgres://postgres:postgres@localhost:5432/evd`           | Auth and backend metadata PostgreSQL connection string |
| `ANALYTICS_DATABASE_URL` | `postgres://warehouse:warehouse123@localhost:5433/warehouse` | Analytics PostgreSQL connection string                 |
| `DATABASE_URL`           | none                                                        | Legacy auth fallback when `AUTH_DATABASE_URL` is unset |
| `PORT`                   | `4000`                                                      | HTTP port                                              |
| `BETTER_AUTH_SECRET`     | `dev-secret-change-me`                                      | Better Auth secret; the dev default lets the server boot unset — always override in production |
| `BETTER_AUTH_URL`        | `http://127.0.0.1:4000`                                     | Public API URL used by auth                            |
| `API_PUBLIC_URL`         | none                                                        | Fallback public API URL if `BETTER_AUTH_URL` is unset  |
| `TRUSTED_ORIGINS`        | Two different defaults — see the note below                 | Comma-separated origins for both CORS and Better Auth  |
| `DASHBOARD_APP_URL`      | `http://localhost:3000`                                     | Password reset destination                             |
| `NEXT_PUBLIC_APP_URL`    | none                                                        | Fallback password reset destination if `DASHBOARD_APP_URL` is unset |
| `UPLOAD_DIR`             | `uploads`                                                   | Disk upload directory                                  |
| `MAIL_FROM_NAME`         | `DHA EVD`                                                   | Outbound mail sender name                              |
| `SMS_SENDER_ID`          | `DHAEVD`                                                    | SMS sender ID                                          |

`TRUSTED_ORIGINS` is read in two places that hardcode **different** fallback lists, so leaving it unset gives CORS and Better Auth divergent trust sets:

- CORS (`src/main.ts`, `src/config/env.config.ts`): `http://localhost:3000,http://localhost:3001,http://localhost:3002,http://localhost:3003`
- Better Auth (`src/auth/auth.ts`): `http://localhost:3000,http://localhost:4000,http://127.0.0.1:3000,http://127.0.0.1:4000`

Unset, auth trusts `localhost:4000` and the `127.0.0.1` origins that CORS rejects, and CORS allows ports 3001-3003 that auth does not trust. Only `http://localhost:3000` is in both lists. Set `TRUSTED_ORIGINS` explicitly in every environment so both paths agree.

## Testing

```bash
npm run build
npm test
```

Tests use `pg-mem` for isolated in-memory PostgreSQL-compatible databases.
