# Changelog

## 0.1.0 (2026-07-09)
- Initial focused DHA EVD backend with auth, users, uploads, mail, SMS, notifications, and health checks.

## 0.2.0 (2026-07-09)
- Disable automatic production deploy webhook in CI while keeping GHCR image builds on version tags.


## 1.0.0 (2026-07-09)
- Major release: PostgreSQL backend replacing MongoDB, with Better Auth Kysely adapter, schema bootstrap, and updated services.


## 1.0.1 (2026-07-09)
- Patch release to align version with dashboard v1.0.1; no functional changes.


## 1.0.2 (2026-07-09)
- Fix Docker build failure by syncing package-lock.json with package.json.


## 1.0.3 (2026-07-09)
- Fix DatabaseService lifecycle hooks by adding `@Injectable()`, restoring schema bootstrap on startup.
- Log PostgreSQL connection details and server port binding during application setup.


## 1.1.0 (2026-07-10)
- Add /api/analytics/metrics backed by a dedicated warehouse PostgreSQL database, with separate AUTH_DATABASE_URL and ANALYTICS_DATABASE_URL connection pools.


## 1.1.1 (2026-07-10)
- Add gold analytics schema guide documenting warehouse layers and /api/analytics/metrics payload fields.


## 1.2.0 (2026-07-10)
- Coordinated minor release for production deployment.


## 2.0.0 (2026-07-10)
- Analytics API computes dashboard delta metrics from 24-hour windows instead of latest reporting date.


## 2.0.1 (2026-07-10)
- Patch release aligned with dashboard v3.0.1; no functional changes.


## 3.0.0 (2026-07-10)
- Major release aligned with dashboard v4.0.0 public dashboard refresh and analytics API coordination.


## 3.1.0 (2026-07-22)
- Align analytics metrics with restored gold warehouse schema, update gold contract documentation, and expand analytics service coverage.


## 3.2.0 (2026-08-05)
- Ship analytics and public-landing backend support, and re-enable the production deploy webhook.

## 3.8.0 (2026-10-07)
- Enter official dated headline figures through reconciliation APIs using an explicit reconciliation role, independently of admin access.
- Keep public cumulative figures current by carrying forward earlier official values when a new record leaves them blank; 24-hour figures remain specific to the latest date.
- Enable a record's operational override to apply confirmed cases, recoveries and deaths to the national Summary and recalculate CFR. New records default to override off.
- Read each record's before/after audit history separately from general audit views, including after clearing a record. Figure writes and audit events commit together.
- Prevent stale amendments and clearing with required revision and record identity checks; HTTP 409 asks the editor to reload the latest record.
- Seed nine source records with `npm run seed:headline`; existing dates are preserved on reruns. Document opt-in real PostgreSQL verification for rollback, concurrency, seeding and role boundaries.
