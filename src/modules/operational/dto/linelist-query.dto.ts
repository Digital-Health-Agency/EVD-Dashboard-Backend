import { z } from 'zod';

import {
  operationalFiltersSchema,
  periodValues,
} from './operational-filters.dto.js';

export { periodValues };

export const sortDirectionValues = ['asc', 'desc'] as const;

export const sortDirectionSchema = z.enum(sortDirectionValues);

export const MAX_LINELIST_PAGE_SIZE = 200;
export const DEFAULT_LINELIST_PAGE_SIZE = 50;

const boundedPageSize = z.coerce
  .number()
  .int()
  .min(1)
  .max(MAX_LINELIST_PAGE_SIZE);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) =>
      value === undefined || value.length === 0 ? undefined : value,
    );

const linelistPagingSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: boundedPageSize.default(DEFAULT_LINELIST_PAGE_SIZE),
  pageSize: boundedPageSize.optional(),
});

export const linelistProjectionSchema = z.object({
  sortBy: optionalText(120),
  sortDir: sortDirectionSchema.default('desc'),
  q: optionalText(200),

  fields: z
    .string()
    .max(1000)
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      const names = value
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name.length > 0);
      return names.length > 0 ? names : undefined;
    }),
});

export const linelistQuerySchema = linelistPagingSchema
  .and(linelistProjectionSchema)
  .and(operationalFiltersSchema);

export type LinelistSortDirection = z.infer<typeof sortDirectionSchema>;
export type LinelistQueryDto = z.infer<typeof linelistQuerySchema>;
