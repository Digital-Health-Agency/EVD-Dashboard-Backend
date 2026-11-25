import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  NotFoundException,
  RequestMethod,
  UnauthorizedException,
  type ExecutionContext,
  type PipeTransform,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';

import { ROLES_KEY } from '../../common/guards/roles.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { envConfig } from '../../config/env.config.js';
import {
  ANALYTICS_POSTGRES_POOL,
  AUTH_POSTGRES_POOL,
  DatabaseModule,
} from '../../database/database.module.js';
import type { AnalyticsService } from '../analytics/analytics.service.js';
import type { HeadlineOverrideRow } from './headline-override.schema.js';
import type { HeadlineOverrideService } from './headline-override.service.js';
import { ReconciliationController } from './reconciliation.controller.js';
import { ReconciliationModule } from './reconciliation.module.js';

const PATH_METADATA = 'path';
const METHOD_METADATA = 'method';
const GUARDS_METADATA = '__guards__';
const HTTP_CODE_METADATA = '__httpCode__';
const ROUTE_ARGS_METADATA = '__routeArguments__';
const PUBLIC_ROUTE_KEY = 'PUBLIC';
const OPTIONAL_AUTH_KEY = 'OPTIONAL';
const BODY_PARAM = 3;
const ROUTE_PARAM = 5;

const SITUATION_DATE = '2026-10-06';
const HANDLERS = [
  'list',
  'warehouse',
  'one',
  'history',
  'create',
  'update',
  'remove',
] as const;

type HandlerName = (typeof HANDLERS)[number];

const ROW = {
  situation_date: SITUATION_DATE,
  deaths: 1,
} as HeadlineOverrideRow;

const GRANT_HOLDER = { user: { id: 'u-1', role: 'admin,reconciliation' } };

function handler(name: HandlerName): (...args: never[]) => unknown {
  const prototype = ReconciliationController.prototype as unknown as Record<
    string,
    (...args: never[]) => unknown
  >;
  return prototype[name];
}

function build() {
  const overrides = {
    list: vi.fn(),
    find: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  };
  const analytics = { getWarehouseHeadline: vi.fn() };
  const controller = new ReconciliationController(
    overrides as unknown as HeadlineOverrideService,
    analytics as unknown as AnalyticsService,
  );
  return { controller, overrides, analytics };
}

function settle<T>(call: () => T | Promise<T>): Promise<T> {
  return (async () => call())();
}

function pipesFor(name: HandlerName, paramType: number): PipeTransform[] {
  const args = (Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    ReconciliationController,
    name,
  ) ?? {}) as Record<string, { pipes: PipeTransform[] }>;
  const pipes = Object.entries(args)
    .filter(([key]) => key.startsWith(`${paramType}:`))
    .flatMap(([, value]) => value.pipes);
  expect(pipes).toHaveLength(1);
  return pipes;
}

function admits(name: HandlerName, user?: { role?: string }): boolean {
  const context = {
    getHandler: () => handler(name),
    getClass: () => ReconciliationController,
    switchToHttp: () => ({
      getRequest: () => (user === undefined ? {} : { user }),
    }),
  } as unknown as ExecutionContext;
  return new RolesGuard(new Reflector()).canActivate(context);
}

describe('ReconciliationController access gate', () => {
  it('requires exactly the reconciliation grant, and never names admin', () => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      ReconciliationController,
    ) as string[];

    expect(roles).toEqual(['reconciliation']);
    expect(roles).not.toContain('admin');
  });

  it('runs RolesGuard on the whole controller', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, ReconciliationController),
    ).toEqual([RolesGuard]);
  });

  it('exposes the record history and existing handlers, the comparison ahead of the dated route', () => {
    expect(
      Object.getOwnPropertyNames(ReconciliationController.prototype).filter(
        (name) => name !== 'constructor',
      ),
    ).toEqual([...HANDLERS]);
  });

  it.each(HANDLERS)(
    'lets no role list on %s replace the class-level gate',
    (name) => {
      expect(Reflect.getMetadata(ROLES_KEY, handler(name))).toBeUndefined();
    },
  );

  it.each(HANDLERS)('marks %s neither public nor optional-auth', (name) => {
    expect(
      Reflect.getMetadata(PUBLIC_ROUTE_KEY, handler(name)),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(OPTIONAL_AUTH_KEY, handler(name)),
    ).toBeUndefined();
  });

  it('marks the controller neither public nor optional-auth', () => {
    expect(
      Reflect.getMetadata(PUBLIC_ROUTE_KEY, ReconciliationController),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(OPTIONAL_AUTH_KEY, ReconciliationController),
    ).toBeUndefined();
  });

  describe.each(HANDLERS)('RolesGuard on %s', (name) => {
    it.each(['reconciliation', 'admin,reconciliation', 'user,reconciliation'])(
      'admits a holder of the grant: %s',
      (role) => {
        expect(admits(name, { role })).toBe(true);
      },
    );

    it.each([
      'admin',
      'admin,surveillance',
      'surveillance',
      'user',
      'reconciliation-lead',
      '',
    ])('refuses %j, which does not hold the grant', (role) => {
      expect(admits(name, { role })).toBe(false);
    });

    it('refuses a request with no user', () => {
      expect(admits(name)).toBe(false);
      expect(admits(name, {})).toBe(false);
    });
  });
});

describe('ReconciliationController routes', () => {
  it('is mounted at api/reconciliation', () => {
    expect(Reflect.getMetadata(PATH_METADATA, ReconciliationController)).toBe(
      'api/reconciliation',
    );
  });

  it.each([
    ['list', RequestMethod.GET, 'headline', undefined],
    ['warehouse', RequestMethod.GET, 'warehouse', undefined],
    ['one', RequestMethod.GET, 'headline/:situationDate', undefined],
    [
      'history',
      RequestMethod.GET,
      'headline/:situationDate/history',
      undefined,
    ],
    ['create', RequestMethod.POST, 'headline', HttpStatus.CREATED],
    ['update', RequestMethod.PATCH, 'headline/:situationDate', undefined],
    [
      'remove',
      RequestMethod.DELETE,
      'headline/:situationDate',
      HttpStatus.NO_CONTENT,
    ],
  ] as const)('routes %s', (name, method, path, httpCode) => {
    expect(Reflect.getMetadata(METHOD_METADATA, handler(name))).toBe(method);
    expect(Reflect.getMetadata(PATH_METADATA, handler(name))).toBe(path);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler(name))).toBe(
      httpCode,
    );
  });
});

describe('ReconciliationController request validation', () => {
  it.each(['one', 'update', 'remove'] as const)(
    'validates the situation date parameter of %s before the handler runs',
    (name) => {
      const [pipe] = pipesFor(name, ROUTE_PARAM);
      const transform = (value: unknown): unknown =>
        pipe.transform(value, { type: 'param', data: 'situationDate' });

      expect(transform(SITUATION_DATE)).toBe(SITUATION_DATE);
      for (const value of [
        '2026-02-30',
        '2026-13-01',
        '06-10-2026',
        "2026-10-06'; DROP TABLE headline_overrides; --",
        'warehouse',
      ]) {
        expect(() => transform(value)).toThrow(BadRequestException);
      }
    },
  );

  it.each(['create', 'update'] as const)(
    'answers an invalid %s body with 400 Validation failed',
    (name) => {
      const [pipe] = pipesFor(name, BODY_PARAM);
      const transform = (value: unknown): unknown =>
        pipe.transform(value, { type: 'body' });
      const key =
        name === 'create'
          ? { situation_date: SITUATION_DATE }
          : { expected_revision: 1, expected_record_id: 'test-record' };

      expect(transform({ ...key, deaths: 1 })).toStrictEqual({
        ...key,
        deaths: 1,
      });
      for (const body of [
        { ...key, deaths: -1 },
        { ...key, deaths: 1.5 },
        { ...key, deaths: '1' },
        { ...key, case_fatality_rate: 50 },
        { ...key, report_date: '2026-02-30' },
      ]) {
        let thrown: unknown;
        try {
          transform(body);
        } catch (error: unknown) {
          thrown = error;
        }
        expect(thrown).toBeInstanceOf(BadRequestException);
        expect((thrown as BadRequestException).getResponse()).toMatchObject({
          message: 'Validation failed',
        });
      }
    },
  );

  it('passes a blank through as null and a zero as zero', () => {
    const [createPipe] = pipesFor('create', BODY_PARAM);
    const [updatePipe] = pipesFor('update', BODY_PARAM);

    expect(
      createPipe.transform(
        { situation_date: SITUATION_DATE, positive_samples: 0, deaths: null },
        { type: 'body' },
      ),
    ).toStrictEqual({
      situation_date: SITUATION_DATE,
      positive_samples: 0,
      deaths: null,
    });
    expect(
      updatePipe.transform(
        {
          expected_revision: 1,
          expected_record_id: 'test-record',
          recoveries: null,
          deaths: 2,
        },
        { type: 'body' },
      ),
    ).toStrictEqual({
      expected_revision: 1,
      expected_record_id: 'test-record',
      recoveries: null,
      deaths: 2,
    });
  });
});

describe('ReconciliationController handlers', () => {
  it('lists the series exactly as the service returned it', async () => {
    const { controller, overrides } = build();
    const rows = [ROW];
    overrides.list.mockResolvedValue(rows);

    const result = await controller.list();

    expect(Object.keys(result)).toEqual(['data']);
    expect(result.data).toBe(rows);
  });

  it('returns the row stored for a situation date', async () => {
    const { controller, overrides } = build();
    overrides.find.mockResolvedValue(ROW);

    await expect(controller.one(SITUATION_DATE)).resolves.toBe(ROW);
    expect(overrides.find).toHaveBeenCalledWith(SITUATION_DATE);
  });

  it('answers 404 for a situation date with no row', async () => {
    const { controller, overrides } = build();
    overrides.find.mockResolvedValue(null);

    await expect(controller.one('2026-10-05')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('creates a row as the session user, role string included', async () => {
    const { controller, overrides } = build();
    const body = { situation_date: SITUATION_DATE, deaths: 1 };
    overrides.create.mockResolvedValue(ROW);

    await expect(controller.create(GRANT_HOLDER, body)).resolves.toBe(ROW);
    expect(overrides.create).toHaveBeenCalledTimes(1);
    expect(overrides.create.mock.calls[0][0]).toBe(body);
    expect(overrides.create.mock.calls[0][1]).toEqual({
      actorId: 'u-1',
      actorRole: 'admin,reconciliation',
    });
  });

  it('reads the actor from userId when the session carries no id', async () => {
    const { controller, overrides } = build();
    overrides.create.mockResolvedValue(ROW);

    await controller.create(
      { user: { userId: 'u-2' } },
      { situation_date: SITUATION_DATE },
    );

    expect(overrides.create.mock.calls[0][1]).toEqual({
      actorId: 'u-2',
      actorRole: null,
    });
  });

  it.each([{}, { user: {} }, { user: { role: 'reconciliation' } }])(
    'refuses to create for the userless request %j without touching the service',
    async (req) => {
      const { controller, overrides } = build();

      await expect(
        settle(() =>
          controller.create(req, { situation_date: SITUATION_DATE }),
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(overrides.create).not.toHaveBeenCalled();
    },
  );

  it('passes a conflict from the service through unchanged', async () => {
    const { controller, overrides } = build();
    const conflict = new ConflictException(
      `A row for ${SITUATION_DATE} already exists. Edit it instead.`,
    );
    overrides.create.mockRejectedValue(conflict);

    await expect(
      settle(() =>
        controller.create(GRANT_HOLDER, { situation_date: SITUATION_DATE }),
      ),
    ).rejects.toBe(conflict);
  });

  it('updates the row for the route date as the session user', async () => {
    const { controller, overrides } = build();
    const body = {
      expected_revision: 1,
      expected_record_id: 'test-record',
      recoveries: null,
      deaths: 2,
    };
    overrides.update.mockResolvedValue(ROW);

    await expect(
      controller.update(SITUATION_DATE, GRANT_HOLDER, body),
    ).resolves.toBe(ROW);
    expect(overrides.update).toHaveBeenCalledTimes(1);
    expect(overrides.update.mock.calls[0][0]).toBe(SITUATION_DATE);
    expect(overrides.update.mock.calls[0][1]).toBe(body);
    expect(overrides.update.mock.calls[0][2]).toEqual({
      actorId: 'u-1',
      actorRole: 'admin,reconciliation',
    });
  });

  it('refuses to update for a userless request without touching the service', async () => {
    const { controller, overrides } = build();

    await expect(
      settle(() =>
        controller.update(
          SITUATION_DATE,
          {},
          {
            expected_revision: 1,
            expected_record_id: 'test-record',
            deaths: 2,
          },
        ),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(overrides.update).not.toHaveBeenCalled();
  });

  it('clears the row for the route date and resolves with no body', async () => {
    const { controller, overrides } = build();
    overrides.remove.mockResolvedValue({ unexpected: true });

    await expect(
      controller.remove(SITUATION_DATE, GRANT_HOLDER, {
        expected_revision: 1,
        expected_record_id: 'test-record',
      }),
    ).resolves.toBeUndefined();
    expect(overrides.remove).toHaveBeenCalledWith(
      SITUATION_DATE,
      {
        actorId: 'u-1',
        actorRole: 'admin,reconciliation',
      },
      1,
      'test-record',
    );
  });

  it('refuses to clear for a userless request without touching the service', async () => {
    const { controller, overrides } = build();

    await expect(
      settle(() =>
        controller.remove(
          SITUATION_DATE,
          {},
          { expected_revision: 1, expected_record_id: 'test-record' },
        ),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(overrides.remove).not.toHaveBeenCalled();
  });

  it('returns the warehouse comparison exactly as analytics computed it', async () => {
    const { controller, overrides, analytics } = build();
    const comparison = { figures: { deaths: 0 }, lastUpdated: null };
    analytics.getWarehouseHeadline.mockResolvedValue(comparison);

    await expect(controller.warehouse()).resolves.toBe(comparison);
    expect(overrides.list).not.toHaveBeenCalled();
  });
});

describe('ReconciliationModule', () => {
  it('compiles beside the database module and provides the controller', async () => {
    const pool = () => ({
      query: vi.fn(() => Promise.resolve({ rows: [], rowCount: 0 })),
      end: vi.fn(() => Promise.resolve()),
    });
    const authPool = pool();
    const analyticsPool = pool();

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          isGlobal: true,
          load: [envConfig],
        }),
        DatabaseModule,
        ReconciliationModule,
      ],
    })
      .overrideProvider(AUTH_POSTGRES_POOL)
      .useValue(authPool)
      .overrideProvider(ANALYTICS_POSTGRES_POOL)
      .useValue(analyticsPool)
      .compile();

    try {
      expect(moduleRef.get(ReconciliationController)).toBeInstanceOf(
        ReconciliationController,
      );
    } finally {
      await moduleRef.close();
    }
    expect(authPool.end).toHaveBeenCalledTimes(1);
    expect(analyticsPool.end).toHaveBeenCalledTimes(1);
  });
});
