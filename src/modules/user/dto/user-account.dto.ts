import { z } from 'zod';

import { AUTH_ROLES, normalizeRoleString } from '../../../common/roles.js';

export const authRoleValues = AUTH_ROLES;

export const authRoleNameSchema = z.enum(AUTH_ROLES);

export const authRoleSchema = z
  .string()
  .trim()
  .max(120)
  .superRefine((value, ctx) => {
    const tokens = value
      .split(',')
      .map((token) => token.trim().toLowerCase())
      .filter((token) => token.length > 0);

    if (tokens.length === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'Role must name at least one role',
      });
      return;
    }

    for (const token of tokens) {
      if (!(AUTH_ROLES as readonly string[]).includes(token)) {
        ctx.addIssue({ code: 'custom', message: `Unknown role: ${token}` });
      }
    }
  })
  .transform((value) => normalizeRoleString(value));

export type AuthRole = z.infer<typeof authRoleSchema>;
export type AuthRoleName = z.infer<typeof authRoleNameSchema>;

export const createUserSchema = z.object({
  name: z.string().trim().min(1),
  email: z.email().transform((email) => email.trim().toLowerCase()),
  password: z.string().min(8).optional(),
  role: authRoleSchema.default('user'),
});

export const updateMeSchema = z.object({
  name: z.string().trim().min(1).optional(),
  image: z.string().trim().nullable().optional(),
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(1).optional(),
  email: z
    .email()
    .transform((email) => email.trim().toLowerCase())
    .optional(),
  role: authRoleSchema.optional(),
  banned: z.boolean().optional(),
});

export const deactivateUserSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const setPasswordSchema = z.object({
  password: z.string().min(8),
});

export type CreateUserDto = z.infer<typeof createUserSchema>;
export type UpdateMeDto = z.infer<typeof updateMeSchema>;
export type UpdateUserDto = z.infer<typeof updateUserSchema>;
export type DeactivateUserDto = z.infer<typeof deactivateUserSchema>;
export type SetPasswordDto = z.infer<typeof setPasswordSchema>;
