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

