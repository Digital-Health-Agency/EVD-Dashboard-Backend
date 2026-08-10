import { z } from 'zod';

import { AUDIT_EVENT_TYPES } from '../audit-event.schema.js';

export const MAX_AUDIT_PAGE_SIZE = 200;
export const DEFAULT_AUDIT_PAGE_SIZE = 20;

export const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_AUDIT_PAGE_SIZE)
    .default(DEFAULT_AUDIT_PAGE_SIZE),

  eventType: z.enum(AUDIT_EVENT_TYPES).optional(),
  actorId: z.string().trim().min(1).max(120).optional(),
});

export type AuditQueryDto = z.infer<typeof auditQuerySchema>;
