import { z } from 'zod';

export const authRoleValues = ['user', 'admin'] as const;

export const authRoleSchema = z.enum(authRoleValues);

export type AuthRole = z.infer<typeof authRoleSchema>;

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
