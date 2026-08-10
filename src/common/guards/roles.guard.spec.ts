import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

import { ROLES_KEY, Roles } from './roles.decorator.js';
import { RolesGuard } from './roles.guard.js';

function contextFor(user?: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Probe {},
    switchToHttp: () => ({
      getRequest: () => (user === undefined ? {} : { user }),
    }),
  } as unknown as ExecutionContext;
}

function guardFor(requiredRoles?: string[]): RolesGuard {
  return new RolesGuard({
    getAllAndOverride: () => requiredRoles,
  } as unknown as Reflector);
}

const admissionCases = [
  {
    name: 'admits a plain admin against @Roles(admin)',
    required: ['admin'],
    user: { role: 'admin' },
    expected: true,
  },
  {
    name: 'admits a compound-role admin against @Roles(admin)',
    required: ['admin'],
    user: { role: 'admin,surveillance' },
    expected: true,
  },
  {
    name: 'admits a compound role whatever the token order',
    required: ['admin'],
    user: { role: 'surveillance,admin' },
    expected: true,
  },
  {
    name: 'admits a compound role padded with whitespace',
    required: ['admin'],
    user: { role: ' admin , surveillance ' },
    expected: true,
  },
  {
    name: 'rejects surveillance alone against @Roles(admin)',
    required: ['admin'],
    user: { role: 'surveillance' },
    expected: false,
  },
  {
    name: 'rejects a plain user against @Roles(admin)',
    required: ['admin'],
    user: { role: 'user' },
    expected: false,
  },
  {
    name: 'rejects administrator — no prefix match',
    required: ['admin'],
    user: { role: 'administrator' },
    expected: false,
  },
  {
    name: 'rejects a request carrying no user',
    required: ['admin'],
    user: undefined,
    expected: false,
  },
  {
    name: 'rejects a user carrying no role property',
    required: ['admin'],
    user: {},
    expected: false,
  },
  {
    name: 'admits on any-of semantics when several roles are required',
    required: ['admin', 'surveillance'],
    user: { role: 'surveillance' },
    expected: true,
  },
];

describe('RolesGuard', () => {
  it('admits a route carrying no @Roles metadata', () => {
    expect(guardFor(undefined).canActivate(contextFor({ role: 'user' }))).toBe(
      true,
    );
    expect(guardFor(undefined).canActivate(contextFor())).toBe(true);
  });

  it.each(admissionCases)('$name', ({ required, user, expected }) => {
    expect(guardFor(required).canActivate(contextFor(user))).toBe(expected);
  });

  it('reads the same metadata key the decorator writes', () => {
    class Probe {
      @Roles('admin')
      handler() {}
    }

    expect(Reflect.getMetadata(ROLES_KEY, Probe.prototype.handler)).toEqual([
      'admin',
    ]);
  });

  it('takes only a Reflector', () => {
    expect(RolesGuard.length).toBe(1);
  });
});
