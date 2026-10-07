import { describe, expect, it } from 'vitest';
import {
  AUTH_ROLES,
  RECONCILIATION_ROLE,
  SURVEILLANCE_ROLE,
  hasAnyRole,
  hasRole,
  normalizeRoleString,
  parseRoles,
  type AuthRoleName,
} from './roles.js';

const subsets: AuthRoleName[][] = Array.from(
  { length: (1 << AUTH_ROLES.length) - 1 },
  (_, index) => AUTH_ROLES.filter((_role, bit) => ((index + 1) >> bit) & 1),
);

describe('AUTH_ROLES', () => {
  it('declares the four role grants in canonical join order', () => {
    expect(AUTH_ROLES).toEqual([
      'user',
      'admin',
      'surveillance',
      'reconciliation',
    ]);
    expect(RECONCILIATION_ROLE).toBe('reconciliation');
  });
});

describe('parseRoles', () => {
  it('resolves a compound role to a canonically ordered set', () => {
    expect(parseRoles('admin,surveillance')).toEqual(['admin', 'surveillance']);
    expect(parseRoles('surveillance,admin')).toEqual(['admin', 'surveillance']);
    expect(parseRoles(' Admin , SURVEILLANCE ')).toEqual([
      'admin',
      'surveillance',
    ]);
    expect(parseRoles('admin,admin')).toEqual(['admin']);
    expect(parseRoles('root,admin')).toEqual(['admin']);
  });

  it('resolves the reconciliation grant in canonical tuple order', () => {
    expect(parseRoles('admin,reconciliation')).toEqual([
      'admin',
      'reconciliation',
    ]);
    expect(parseRoles('reconciliation, surveillance, admin')).toEqual([
      'admin',
      'surveillance',
      'reconciliation',
    ]);
  });

  it('matches whole tokens only, never a substring', () => {
    expect(parseRoles('surveillance-lead')).toEqual([]);
    expect(parseRoles('not-surveillance')).toEqual([]);
    expect(parseRoles('administrator')).toEqual([]);
  });

  it('returns an empty set for every degenerate input', () => {
    expect(parseRoles(undefined)).toEqual([]);
    expect(parseRoles(null)).toEqual([]);
    expect(parseRoles('')).toEqual([]);
    expect(parseRoles(',,,')).toEqual([]);
    expect(parseRoles(42 as unknown as string)).toEqual([]);
    expect(parseRoles({} as unknown as string)).toEqual([]);
  });
});

describe('hasRole', () => {
  it('finds a role inside a compound set', () => {
    expect(hasRole('admin,surveillance', SURVEILLANCE_ROLE)).toBe(true);
    expect(hasRole('surveillance', SURVEILLANCE_ROLE)).toBe(true);
    expect(hasRole('admin,surveillance', 'admin')).toBe(true);
  });

  it('is false when the role is absent or the input is degenerate', () => {
    expect(hasRole('admin', SURVEILLANCE_ROLE)).toBe(false);
    expect(hasRole('user', SURVEILLANCE_ROLE)).toBe(false);
    expect(hasRole('surveillance-lead', SURVEILLANCE_ROLE)).toBe(false);
    expect(hasRole(null, SURVEILLANCE_ROLE)).toBe(false);
    expect(hasRole(undefined, SURVEILLANCE_ROLE)).toBe(false);
  });

  it('does not treat admin as a holder of the reconciliation grant', () => {
    expect(hasRole('admin', RECONCILIATION_ROLE)).toBe(false);
    expect(hasRole('admin,surveillance', RECONCILIATION_ROLE)).toBe(false);
    expect(hasRole('user,reconciliation', RECONCILIATION_ROLE)).toBe(true);
    expect(hasRole('reconciliation-lead', RECONCILIATION_ROLE)).toBe(false);
  });
});

describe('hasAnyRole', () => {
  it('is a non-empty intersection with the required names', () => {
    expect(hasAnyRole('admin,surveillance', ['admin'])).toBe(true);
    expect(hasAnyRole('surveillance,admin', ['admin'])).toBe(true);
    expect(hasAnyRole('surveillance', ['admin', 'surveillance'])).toBe(true);
  });

  it('is false when the sets are disjoint or either side is empty', () => {
    expect(hasAnyRole('surveillance', ['admin'])).toBe(false);
    expect(hasAnyRole('administrator', ['admin'])).toBe(false);
    expect(hasAnyRole('admin', [])).toBe(false);
    expect(hasAnyRole(null, ['admin'])).toBe(false);
  });
});

describe('normalizeRoleString', () => {
  it('emits a canonical comma-joined string carrying no space character', () => {
    const normalized = normalizeRoleString('surveillance, admin');
    expect(normalized).toBe('admin,surveillance');
    expect(normalized.includes(' ')).toBe(false);
    expect(normalizeRoleString(' Admin , SURVEILLANCE ').includes(' ')).toBe(
      false,
    );
  });

  it('serialises the reconciliation grant after admin with no space', () => {
    const normalized = normalizeRoleString('reconciliation, admin');
    expect(normalized).toBe('admin,reconciliation');
    expect(normalized.includes(' ')).toBe(false);
  });

  it('falls back to user rather than throwing on an unusable role', () => {
    expect(normalizeRoleString('root')).toBe('user');
    expect(normalizeRoleString(undefined)).toBe('user');
    expect(normalizeRoleString(null)).toBe('user');
    expect(normalizeRoleString('')).toBe('user');
  });
});

describe('role set round trip', () => {
  it.each(subsets)('survives serialization for %j', (...combo) => {
    const expected = combo as AuthRoleName[];
    expect(parseRoles(normalizeRoleString(expected.join(',')))).toEqual(
      expected,
    );
    expect(
      parseRoles(normalizeRoleString([...expected].reverse().join(','))),
    ).toEqual(expected);
  });
});
