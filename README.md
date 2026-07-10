# DHA EVD Backend Server

Focused NestJS API for the Kenya EVD dashboard stack. The server owns authentication, user administration, media uploads, notifications, mail delivery, SMS delivery logging, and health checks.

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
  modules/
    user/          Better Auth user/account/session administration
    upload/        Disk upload endpoint and media metadata
    notification/  In-app notification records and inbox APIs
    mail/          Injectable SMTP mail service
    sms/           Injectable SMS service and delivery callback
```

## API Surface

| Method                  | Path                             | Description                                    |
| ----------------------- | -------------------------------- | ---------------------------------------------- |
| `*`                     | `/api/auth/*`                    | Better Auth routes                             |
| `GET`                   | `/health`                        | Public health check                            |
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
| `BETTER_AUTH_SECRET`     | required                                                    | Better Auth secret                                     |
| `BETTER_AUTH_URL`        | `http://localhost:4000`                                     | Public API URL used by auth                            |
| `TRUSTED_ORIGINS`        | `http://localhost:4000,http://localhost:3000`               | CORS and auth origins                                  |
| `DASHBOARD_APP_URL`      | `http://localhost:3000`                                     | Password reset destination                             |
| `UPLOAD_DIR`             | `uploads`                                                   | Disk upload directory                                  |
| `MAIL_FROM_NAME`         | `DHA EVD`                                                   | Outbound mail sender name                              |
| `SMS_SENDER_ID`          | `DHAEVD`                                                    | SMS sender ID                                          |

## Testing

```bash
npm run build
npm test
```

Tests use `pg-mem` for isolated in-memory PostgreSQL-compatible databases.
