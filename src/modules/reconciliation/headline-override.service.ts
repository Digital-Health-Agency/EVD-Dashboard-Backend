import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  DatabaseService,
  type Queryable,
} from '../../database/database.module.js';
import { resolveHeadlineRow } from './headline-override-merge.js';
import { AuditService } from '../audit/audit.service.js';
import {
  HEADLINE_FIGURE_FIELDS,
  HEADLINE_OVERRIDE_EVENT,
  type HeadlineFigures,
  type HeadlineOverrideRow,
} from './headline-override.schema.js';

export interface HeadlineOverrideActor {
  actorId: string | null;
  actorRole: string | null;
}

export type HeadlineOverrideCreateInput = {
  situation_date: string;
  report_date?: string | null;
  source_label?: string | null;
  notes?: string | null;
  operational_override?: boolean;
} & Partial<HeadlineFigures>;

export type HeadlineOverrideUpdateInput = Omit<
  HeadlineOverrideCreateInput,
  'situation_date'
> & { expected_revision?: number; expected_record_id?: string };

const EDITABLE_FIELDS = [
  'report_date',
  'source_label',
  'notes',
  'operational_override',
  ...HEADLINE_FIGURE_FIELDS,
] as const;

const ROW_FIELDS = ['situation_date', ...EDITABLE_FIELDS] as const;

const UNIQUE_VIOLATION = '23505';

type RowSnapshot = Pick<HeadlineOverrideRow, (typeof ROW_FIELDS)[number]>;

type OverrideAction = 'create' | 'update' | 'delete';

function snapshot(row: HeadlineOverrideRow): RowSnapshot {
  return Object.fromEntries(
    ROW_FIELDS.map((field) => [
      field,
      row[field] ?? (field === 'operational_override' ? false : null),
    ]),
  ) as RowSnapshot;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

@Injectable()
export class HeadlineOverrideService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<HeadlineOverrideRow[]> {
    const result = await this.db.query<HeadlineOverrideRow>(
      'SELECT * FROM headline_overrides ORDER BY situation_date DESC',
    );
    return result.rows;
  }

  find(situationDate: string): Promise<HeadlineOverrideRow | null> {
    return this.read(this.db, situationDate);
  }

  async latestAtOrBefore(
    periodEnd: string | null,
  ): Promise<HeadlineOverrideRow | null> {
    const result = await this.db.query<HeadlineOverrideRow>(
      periodEnd === null
        ? 'SELECT * FROM headline_overrides ORDER BY situation_date DESC'
        : 'SELECT * FROM headline_overrides WHERE situation_date <= $1 ORDER BY situation_date DESC',
      periodEnd === null ? [] : [periodEnd],
    );
    return resolveHeadlineRow(result.rows);
  }

  create(
    input: HeadlineOverrideCreateInput,
    actor: HeadlineOverrideActor,
  ): Promise<HeadlineOverrideRow> {
    const situationDate = input.situation_date;
    const conflict = () =>
      new ConflictException(
        `A row for ${situationDate} already exists. Edit it instead.`,
      );

    return this.db.transaction(async (client) => {
      if (await this.read(client, situationDate)) throw conflict();

      const placeholders = ROW_FIELDS.map((_, index) => `$${index + 1}`);
      try {
        await client.query(
          `
            INSERT INTO headline_overrides (${ROW_FIELDS.join(', ')}, "updatedBy", record_id)
            VALUES (${placeholders.join(', ')}, $${ROW_FIELDS.length + 1}, $${ROW_FIELDS.length + 2})
          `,
          [
            ...ROW_FIELDS.map(
              (field) =>
                input[field] ??
                (field === 'operational_override' ? false : null),
            ),
            actor.actorId,
            randomUUID(),
          ],
        );
      } catch (error: unknown) {
        if (isUniqueViolation(error)) throw conflict();
        throw error;
      }

      const stored = await this.readStored(client, situationDate);
      await this.recordChange(client, actor, {
        action: 'create',
        situationDate,
        columns: ROW_FIELDS.filter(
          (field) => input[field] !== null && input[field] !== undefined,
        ),
        before: null,
        after: snapshot(stored),
      });
      return stored;
    });
  }

  update(
    situationDate: string,
    input: HeadlineOverrideUpdateInput,
    actor: HeadlineOverrideActor,
  ): Promise<HeadlineOverrideRow> {
    return this.db.transaction(async (client) => {
      const before = await this.readStored(client, situationDate, true);

      this.assertRevision(
        before,
        input.expected_revision,
        input.expected_record_id,
      );
      const changed = EDITABLE_FIELDS.filter(
        (field) =>
          input[field] !== undefined &&
          (before[field] ?? null) !== input[field],
      );
      if (changed.length === 0) return before;
      const values: unknown[] = [situationDate];
      const assignments: string[] = [];
      for (const field of changed) {
        if (input[field] === undefined) continue;
        values.push(input[field]);
        assignments.push(`${field} = $${values.length}`);
      }
      values.push(actor.actorId);
      assignments.push(
        `"updatedBy" = $${values.length}`,
        '"updatedAt" = now()',
        'revision = revision + 1',
      );

      await client.query(
        `UPDATE headline_overrides SET ${assignments.join(', ')} WHERE situation_date = $1`,
        values,
      );

      const after = await this.readStored(client, situationDate);
      await this.recordChange(client, actor, {
        action: 'update',
        situationDate,
        columns: EDITABLE_FIELDS.filter(
          (field) => (before[field] ?? null) !== (after[field] ?? null),
        ),
        before: snapshot(before),
        after: snapshot(after),
      });
      return after;
    });
  }

  remove(
    situationDate: string,
    actor: HeadlineOverrideActor,
    expectedRevision?: number,
    expectedRecordId?: string,
  ): Promise<void> {
    return this.db.transaction(async (client) => {
      const before = await this.readStored(client, situationDate, true);

      this.assertRevision(before, expectedRevision, expectedRecordId);
      await client.query(
        'DELETE FROM headline_overrides WHERE situation_date = $1',
        [situationDate],
      );

      await this.recordChange(client, actor, {
        action: 'delete',
        situationDate,
        columns: ROW_FIELDS,
        before: snapshot(before),
        after: null,
      });
    });
  }

  async history(situationDate: string, page: number, limit: number) {
    const predicate = `e."eventType" = $1 AND e.filters->>'situationDate' = $2`;
    const [data, count] = await Promise.all([
      this.db.query(
        `SELECT e.*, u.name AS "actorName" FROM audit_events e LEFT JOIN "user" u ON u.id = e."actorId" WHERE ${predicate} ORDER BY e."createdAt" DESC, e.id DESC LIMIT $3 OFFSET $4`,
        ['headline_override', situationDate, limit, (page - 1) * limit],
      ),
      this.db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM audit_events e WHERE ${predicate}`,
        ['headline_override', situationDate],
      ),
    ]);
    return { data: data.rows, total: Number(count.rows[0].count), page, limit };
  }

  private async read(
    db: Queryable,
    situationDate: string,
    lock = false,
  ): Promise<HeadlineOverrideRow | null> {
    const result = await db.query<HeadlineOverrideRow>(
      `SELECT * FROM headline_overrides WHERE situation_date = $1${lock ? ' FOR UPDATE' : ''}`,
      [situationDate],
    );
    return result.rows[0] ?? null;
  }

  private async readStored(
    db: Queryable,
    situationDate: string,
    lock = false,
  ): Promise<HeadlineOverrideRow> {
    const row = await this.read(db, situationDate, lock);
    if (!row) {
      throw new NotFoundException(`Headline row ${situationDate} not found`);
    }
    return row;
  }

  private assertRevision(
    row: HeadlineOverrideRow,
    expectedRevision?: number,
    expectedRecordId?: string,
  ): void {
    if (
      (expectedRevision !== undefined && expectedRevision !== row.revision) ||
      (expectedRecordId !== undefined && expectedRecordId !== row.record_id)
    ) {
      throw new ConflictException(
        'This record changed since you opened it. Reload the latest figures before saving or clearing.',
      );
    }
  }

  private recordChange(
    client: Queryable,
    actor: HeadlineOverrideActor,
    change: {
      action: OverrideAction;
      situationDate: string;
      columns: readonly string[];
      before: RowSnapshot | null;
      after: RowSnapshot | null;
    },
  ): Promise<void> {
    return this.audit.recordOrThrow(
      {
        eventType: HEADLINE_OVERRIDE_EVENT,
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        dataset: HEADLINE_OVERRIDE_EVENT,
        columns: change.columns,
        filters: {
          situationDate: change.situationDate,
          action: change.action,
          before: change.before,
          after: change.after,
        },
        rowCount: 1,
        outcome: 'ok',
      },
      client,
    );
  }
}
