import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';

import { ROLES_KEY } from '../../common/guards/roles.decorator.js';
import type { Queryable } from '../../database/database.module.js';
import { AuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';
import { auditQuerySchema } from './dto/audit-query.dto.js';

const PUBLIC_ROUTE_KEY = 'PUBLIC';

describe('auditQuerySchema', () => {
  it('defaults page to 1 and limit to 20', () => {
    expect(auditQuerySchema.parse({})).toMatchObject({ page: 1, limit: 20 });
  });

  it('coerces page and limit strings to integers', () => {
    const parsed = auditQuerySchema.parse({ page: '3', limit: '50' });
    expect(parsed.page).toBe(3);
    expect(parsed.limit).toBe(50);
  });

  it('rejects a limit above the maximum', () => {
    expect(() => auditQuerySchema.parse({ limit: '5000' })).toThrow();
  });

  it('rejects a page below 1', () => {
    expect(() => auditQuerySchema.parse({ page: '0' })).toThrow();
  });

  it('accepts a known eventType', () => {
    expect(auditQuerySchema.parse({ eventType: 'pii_export' }).eventType).toBe(
      'pii_export',
    );
  });

  it('rejects an unknown eventType', () => {
    expect(() => auditQuerySchema.parse({ eventType: 'nope' })).toThrow();
  });

  it('accepts an actorId and rejects one beyond the length bound', () => {
    expect(auditQuerySchema.parse({ actorId: 'user-1' }).actorId).toBe(
      'user-1',
    );
    expect(() =>
      auditQuerySchema.parse({ actorId: 'x'.repeat(121) }),
    ).toThrow();
  });

  it('carries no free-text search parameter', () => {
    const parsed = auditQuerySchema.parse({ q: 'Wanjiku' }) as Record<
      string,
      unknown
    >;
    expect(parsed.q).toBeUndefined();
  });
});

function serviceWith(query: ReturnType<typeof vi.fn>) {
  const db: Queryable = { query } as unknown as Queryable;
  return new AuditService(db);
}

function pagedResult(rows: unknown[], count: string) {
  return vi.fn((sql: string) =>
    sql.includes('count(*)')
      ? Promise.resolve({ rows: [{ count }], rowCount: 1 })
      : Promise.resolve({ rows, rowCount: rows.length }),
  );
}

describe('AuditService.findAll', () => {
  it('returns the data, total, page and limit envelope', async () => {
    const query = pagedResult([{ id: 'a' }], '7');
    const service = serviceWith(query);

    const result = await service.findAll(auditQuerySchema.parse({}));

    expect(Object.keys(result).sort()).toEqual([
      'data',
      'limit',
      'page',
      'total',
    ]);
    expect(result.data).toEqual([{ id: 'a' }]);
    expect(result.total).toBe(7);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
  });

  it('orders rows by createdAt descending', async () => {
    const query = pagedResult([], '0');
    const service = serviceWith(query);

    await service.findAll(auditQuerySchema.parse({}));

    const rowSql = query.mock.calls
      .map((call) => call[0] as string)
      .find((sql) => !sql.includes('count(*)'));
    expect(rowSql).toContain('ORDER BY e."createdAt" DESC');
  });

  it('resolves the actor name through a left join on the auth user table', async () => {
    const query = pagedResult([], '0');
    const service = serviceWith(query);

    await service.findAll(auditQuerySchema.parse({}));

    const rowSql = query.mock.calls
      .map((call) => call[0] as string)
      .find((sql) => !sql.includes('count(*)')) as string;
    expect(rowSql).toContain('LEFT JOIN "user" u ON u.id = e."actorId"');
    expect(rowSql).toContain('u.name AS "actorName"');
    expect(rowSql).not.toContain('INNER JOIN');
  });

  it('selects no account column beyond the name', async () => {
    const query = pagedResult([], '0');
    const service = serviceWith(query);

    await service.findAll(auditQuerySchema.parse({}));

    const rowSql = query.mock.calls
      .map((call) => call[0] as string)
      .find((sql) => !sql.includes('count(*)')) as string;
    expect(rowSql).not.toContain('u.email');
    expect(rowSql).not.toContain('u.*');
  });

  it('excludes reconciliation history when no filters are supplied', async () => {
    const query = pagedResult([], '0');
    const service = serviceWith(query);

    await service.findAll(auditQuerySchema.parse({}));

    for (const call of query.mock.calls) {
      expect(call[0] as string).toContain(
        `e."eventType" <> 'headline_override'`,
      );
    }
  });

  it('passes a filter value as a positional parameter, never interpolated', async () => {
    const query = pagedResult([], '0');
    const service = serviceWith(query);

    await service.findAll(
      auditQuerySchema.parse({
        eventType: 'pii_export',
        page: '1',
        limit: '20',
      }),
    );

    const rowSql = query.mock.calls
      .map((call) => call[0] as string)
      .find((sql) => !sql.includes('count(*)')) as string;
    expect(rowSql).not.toContain('pii_export');
    expect(rowSql).toContain('WHERE');
    expect(rowSql).toContain('"eventType" = $1');

    const rowValues = query.mock.calls.find(
      (call) => !(call[0] as string).includes('count(*)'),
    )?.[1] as unknown[];
    expect(rowValues).toContain('pii_export');
  });

  it('filters on actorId as a positional parameter', async () => {
    const query = pagedResult([], '0');
    const service = serviceWith(query);

    await service.findAll(auditQuerySchema.parse({ actorId: 'user-1' }));

    const rowSql = query.mock.calls
      .map((call) => call[0] as string)
      .find((sql) => !sql.includes('count(*)')) as string;
    expect(rowSql).not.toContain('user-1');
    expect(rowSql).toContain('"actorId" = $1');
  });

  it('applies the paging offset', async () => {
    const query = pagedResult([], '0');
    const service = serviceWith(query);

    await service.findAll(auditQuerySchema.parse({ page: '3', limit: '20' }));

    const rowValues = query.mock.calls.find(
      (call) => !(call[0] as string).includes('count(*)'),
    )?.[1] as unknown[];
    expect(rowValues).toEqual([20, 40]);
  });

  it('propagates a database error rather than swallowing it', async () => {
    const query = vi.fn(() => Promise.reject(new Error('connection lost')));
    const service = serviceWith(query);

    await expect(service.findAll(auditQuerySchema.parse({}))).rejects.toThrow(
      'connection lost',
    );
  });
});

describe('AuditController', () => {
  it('forwards the validated query to findAll and returns its result unchanged', async () => {
    const result = { data: [], total: 0, page: 1, limit: 20 };
    const findAll = vi.fn().mockResolvedValue(result);
    const controller = new AuditController({
      findAll,
    } as unknown as AuditService);

    const query = auditQuerySchema.parse({ page: '2' });
    const returned = await controller.events(query);

    expect(findAll).toHaveBeenCalledWith(query);
    expect(returned).toBe(result);
  });

  it('gates the events handler on the admin role', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, AuditController.prototype.events),
    ).toEqual(['admin']);
  });

  it('carries no public-route metadata on the events handler', () => {
    expect(
      Reflect.getMetadata(PUBLIC_ROUTE_KEY, AuditController.prototype.events),
    ).toBeUndefined();
  });

  it('carries no public-route metadata on the controller', () => {
    expect(
      Reflect.getMetadata(PUBLIC_ROUTE_KEY, AuditController),
    ).toBeUndefined();
  });
});
