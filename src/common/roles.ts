export const AUTH_ROLES = ['user', 'admin', 'surveillance'] as const;

export const SURVEILLANCE_ROLE = 'surveillance';

export type AuthRoleName = (typeof AUTH_ROLES)[number];

export function parseRoles(role?: string | null): AuthRoleName[] {
  if (typeof role !== 'string') return [];
  const resolved = new Set<AuthRoleName>();
  for (const part of role.split(',')) {
    const token = part.trim().toLowerCase();
    if (isAuthRoleName(token)) resolved.add(token);
  }
  return AUTH_ROLES.filter((name) => resolved.has(name));
}

export function hasRole(
  role: string | null | undefined,
  name: AuthRoleName,
): boolean {
  return parseRoles(role).includes(name);
}

export function hasAnyRole(
  role: string | null | undefined,
  names: readonly string[],
): boolean {
  return parseRoles(role).some((resolved) => names.includes(resolved));
}

export function normalizeRoleString(role?: string | null): string {
  const resolved = parseRoles(role);
  return resolved.length > 0 ? resolved.join(',') : 'user';
}

function isAuthRoleName(value: string): value is AuthRoleName {
  return (AUTH_ROLES as readonly string[]).includes(value);
}
