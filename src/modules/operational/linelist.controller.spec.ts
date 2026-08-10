import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';

import { NoStoreInterceptor } from '../../common/interceptors/no-store.interceptor.js';
import { linelistQuerySchema } from './dto/linelist-query.dto.js';
import {
  LinelistController,
  resolveLinelistAccess,
} from './linelist.controller.js';
import type { LinelistService } from './linelist.service.js';

const PUBLIC_ROUTE_KEY = 'PUBLIC';
const INTERCEPTORS_METADATA = '__interceptors__';

const handlers = [
  'labResults',
  'screenings',
  'cases',
  'outcomes',
  'contacts',
  'signals',
] as const;

const forwardingCases = handlers.flatMap((handler) =>
  [
    { role: 'admin,surveillance', allowPii: true },
    { role: 'surveillance', allowPii: true },
    { role: 'admin', allowPii: false },
  ].map((grant) => ({ handler, ...grant })),
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
    async ({ handler, role, allowPii }) => {
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
        allowPii,
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

  it('carries the no-store interceptor on the controller, covering every route', () => {
    const declared = Reflect.getMetadata(
      INTERCEPTORS_METADATA,
      LinelistController,
    );

    expect(Array.isArray(declared)).toBe(true);
    expect(declared).toContain(NoStoreInterceptor);
  });

  it.each(handlers)(
    'does not re-declare the interceptor on %s',
    (handler) => {
      expect(
        Reflect.getMetadata(
          INTERCEPTORS_METADATA,
          LinelistController.prototype[handler],
        ),
      ).toBeUndefined();
    },
  );
});

describe('linelist pii access policy', () => {
  it('authorises only a session whose role resolves to surveillance', () => {
    expect(
      resolveLinelistAccess({ user: { id: 'a', role: 'surveillance' } }),
    ).toEqual({ userId: 'a', role: 'surveillance', allowPii: true });

    expect(
      resolveLinelistAccess({ user: { id: 'a', role: 'admin,surveillance' } }),
    ).toEqual({ userId: 'a', role: 'admin,surveillance', allowPii: true });
  });

  it('denies every role that does not resolve to surveillance', () => {
    expect(resolveLinelistAccess({ user: { id: 'a', role: 'admin' } })).toEqual(
      { userId: 'a', role: 'admin', allowPii: false },
    );

    for (const role of [
      'user',
      'viewer',
      'analyst',
      'ADMIN',
      '',
      'surveillance-lead',
    ]) {
      expect(
        resolveLinelistAccess({ user: { id: 'b', role } }).allowPii,
        role,
      ).toBe(false);
    }
  });

  it('denies an authenticated session with no declared role', () => {
    expect(resolveLinelistAccess({ user: { id: 'c' } })).toEqual({
      userId: 'c',
      role: null,
      allowPii: false,
    });
    expect(resolveLinelistAccess({ user: { userId: 'd' } })).toEqual({
      userId: 'd',
      role: null,
      allowPii: false,
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
