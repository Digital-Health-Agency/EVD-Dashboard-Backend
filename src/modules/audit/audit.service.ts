import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import {
  AUTH_POSTGRES_POOL,
  type Queryable,
} from '../../database/database.module.js';
import type { AuditEventDocument } from './audit-event.schema.js';
import type { AuditQueryDto } from './dto/audit-query.dto.js';

export interface AuditEventPage {
  data: AuditEventDocument[];
  total: number;
  page: number;
  limit: number;
}

export interface AuditEventInput {
  eventType: string;
  actorId: string | null;
  actorRole: string | null;
  dataset: string | null;
  columns: readonly string[];
  filters: Record<string, unknown>;
  rowCount?: number | null;
  outcome?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(AUTH_POSTGRES_POOL) private readonly db: Queryable) {}

  async recordOrThrow(
    event: AuditEventInput,
    db: Queryable = this.db,
  ): Promise<void> {
    await db.query(
      `
        INSERT INTO audit_events
          (id, "eventType", "actorId", "actorRole", dataset, columns, filters, "rowCount", outcome)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        randomUUID(),
        event.eventType,
        event.actorId ?? null,
        event.actorRole ?? null,
        event.dataset ?? null,
        [...event.columns],
        JSON.stringify(event.filters ?? {}),
        event.rowCount ?? null,
        event.outcome ?? 'ok',
      ],
    );
  }

  async record(event: AuditEventInput): Promise<void> {
    try {
      await this.recordOrThrow(event);
    } catch (error: unknown) {
      const failure = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `audit write failed: eventType=${event.eventType} ${failure.message}`,
        failure.stack,
      );
    }
  }

  async findAll(query: AuditQueryDto): Promise<AuditEventPage> {
    const { page, limit } = query;
    const values: unknown[] = [];
    const predicates: string[] = [`e."eventType" <> 'headline_override'`];

    if (query.eventType !== undefined) {
      values.push(query.eventType);
      predicates.push(`e."eventType" = $${values.length}`);
    }
    if (query.actorId !== undefined) {
      values.push(query.actorId);
      predicates.push(`e."actorId" = $${values.length}`);
    }

    const where =
      predicates.length > 0 ? `WHERE ${predicates.join(' AND ')} ` : '';
    const offset = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.db.query<AuditEventDocument>(
        `SELECT e.*, u.name AS "actorName" FROM audit_events e LEFT JOIN "user" u ON u.id = e."actorId" ${where}ORDER BY e."createdAt" DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, limit, offset],
      ),
      this.db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM audit_events e ${where}`,
        values,
      ),
    ]);

    return {
      data: data.rows,
      total: Number(total.rows[0].count),
      page,
      limit,
    };
  }
}
