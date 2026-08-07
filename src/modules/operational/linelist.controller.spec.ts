import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';

import { linelistQuerySchema } from './dto/linelist-query.dto.js';
import {
  LinelistController,
  resolveLinelistAccess,
} from './linelist.controller.js';
import type { LinelistService } from './linelist.service.js';

const PUBLIC_ROUTE_KEY = 'PUBLIC';

const handlers = [
  'labResults',
  'screenings',
  'cases',
  'outcomes',
  'contacts',
  'signals',
] as const;

const forwardingCases = handlers.flatMap((handler) =>
  ['admin', 'viewer'].map((role) => ({ handler, role })),
);

describe('LinelistController', () => {
  it('carries no public-route metadata on the controller', () => {
    expect(
      Reflect.getMetadata(PUBLIC_ROUTE_KEY, LinelistController),
    ).toBeUndefined();
  });

  it.each(handlers)('carries no public-route metadata on %s', (handler) => {
    expect(
      Reflect.getMetadata(
        PUBLIC_ROUTE_KEY,
        LinelistController.prototype[handler],
      ),
    ).toBeUndefined();
  });

  it.each(forwardingCases)(
    '$handler forwards the validated query and a $role caller access to its service method',
    async ({ handler, role }) => {
      const result = { data: [], total: 0, page: 1, limit: 50 };
      const method = vi.fn().mockResolvedValue(result);
      const controller = new LinelistController({
        [handler]: method,
      } as unknown as LinelistService);

      const query = linelistQuerySchema.parse({ period: '42d', page: '2' });
      const req = { user: { id: 'u-1', role } };
      const returned = await controller[handler](query, req);

      expect(method).toHaveBeenCalledWith(query, {
        userId: 'u-1',
        role,
        allowPii: true,
      });
      expect(returned).toBe(result);
    },
  );

  it('exposes exactly six handlers and no dataset path parameter', () => {
    const routes = Object.getOwnPropertyNames(
      LinelistController.prototype,
    ).filter((name) => name !== 'constructor');

    expect(routes.sort()).toEqual([...handlers].sort());
  });
});

describe('linelist pii access policy', () => {
  it('authorises any authenticated session, whatever the role', () => {
    expect(resolveLinelistAccess({ user: { id: 'a', role: 'admin' } })).toEqual(
      { userId: 'a', role: 'admin', allowPii: true },
    );

    for (const role of ['user', 'viewer', 'analyst', 'ADMIN', '']) {
      expect(
        resolveLinelistAccess({ user: { id: 'b', role } }).allowPii,
        role,
      ).toBe(true);
    }
  });

  it('authorises an authenticated session with no declared role', () => {
    expect(resolveLinelistAccess({ user: { id: 'c' } })).toEqual({
      userId: 'c',
      role: null,
      allowPii: true,
    });
    expect(resolveLinelistAccess({ user: { userId: 'd' } })).toEqual({
      userId: 'd',
      role: null,
      allowPii: true,
    });
  });

  it('still denies an absent principal', () => {
    expect(resolveLinelistAccess({})).toEqual({
      userId: null,
      role: null,
      allowPii: false,
    });
    expect(resolveLinelistAccess()).toEqual({
      userId: null,
      role: null,
      allowPii: false,
    });
  });

  it('carries the principal through for the access log', () => {
    expect(resolveLinelistAccess({ user: { userId: 'd' } }).userId).toBe('d');
    expect(resolveLinelistAccess({}).userId).toBeNull();
    expect(resolveLinelistAccess({}).role).toBeNull();
  });
});
