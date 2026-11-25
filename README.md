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
    analytics/     Gold-backed analytics with reconciled national headline figures
    reconciliation/ Official dated headline records, optimistic writes, and record audit history
  scripts/         Standalone scripts such as the admin seeder
  health.controller.ts  Public health check endpoint
```

## API Surface

| Method                  | Path                             | Description                                    |
| ----------------------- | -------------------------------- | ---------------------------------------------- |
| `*`                     | `/api/auth/*`                    | Better Auth routes                             |
| `GET`                   | `/health`                        | Public health check                            |
| `GET`                   | `/api/analytics/metrics`         | Gold-backed dashboard analytics                |
| `GET/POST`              | `/api/reconciliation/headline`   | List or create official dated headline records |
| `GET/PATCH/DELETE`       | `/api/reconciliation/headline/:situationDate` | Read, amend or clear a dated record |
| `GET`                   | `/api/reconciliation/headline/:situationDate/history` | Paginated record audit history |
| `GET`                   | `/api/reconciliation/warehouse` | Warehouse figures for comparison |
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

## Reconciled Headline Figures

Users need the explicit `reconciliation` role to list, enter, amend or clear
headline records and read their history. Administrators grant this role through
user management; the `admin` role alone does not grant reconciliation access.

Public headline figures use official records by situation date. A blank cumulative
field carries forward the most recent earlier nonblank official value, then falls
back to the warehouse if no official value exists. An explicit zero is a value.
Blank 24-hour fields fall back to the warehouse without carrying an earlier day's
24-hour figure forward. Screening-point capacity also uses only the latest date;
a blank capacity falls back to the warehouse.

Each record has an `operational_override` toggle, defaulting to `false`. For a
national operational Summary, the latest applicable record's enabled toggle allows
confirmed cases, recoveries and deaths to use reconciled values; CFR is calculated
from those figures. Geography-filtered summaries continue to use their warehouse
scope.

`GET /api/reconciliation/headline/:situationDate` returns `revision` and
`record_id`. PATCH bodies must include both `expected_revision` and
`expected_record_id` from that response; DELETE requires those values as query
parameters. Stale writes return HTTP 409. Reload the latest record before retrying.
Writes and their before/after audit values commit in the same transaction. Record
history uses `page` (default 1) and `limit` (default 20, maximum 100), and remains
available after clearing a record. Reconciliation events are excluded from the
general audit views.

To seed the nine source records from 27 September through 6 October 2026:

```bash
npm run seed:headline
# For a compiled production installation:
npm run seed:headline:prod
```

Run from the backend directory. The seeder loads `.env` and resolves the auth
metadata connection using `AUTH_DATABASE_URL`, with `DATABASE_URL` as its legacy
fallback. It creates missing dates with audit events and operational override off;
rerunning skips existing dates without overwriting their figures or adding audit
events.

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

Tests use `pg-mem` for isolated in-memory PostgreSQL-compatible databases. To
verify transaction rollback, simultaneous writes, record replacement protection,
seed idempotency and authenticated role boundaries against real PostgreSQL:

```bash
npm run build
HEADLINE_POSTGRES_TEST=1 node --env-file=.env node_modules/vitest/vitest.mjs run src/modules/reconciliation/headline-postgres.spec.ts
```

This opt-in suite uses `DATABASE_URL` and creates a disposable, uniquely named
schema that it removes afterward. The database account must be able to create
schemas; the suite does not write to existing application tables.
