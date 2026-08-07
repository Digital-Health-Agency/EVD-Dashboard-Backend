import { z } from 'zod';

import { linelistProjectionSchema } from './linelist-query.dto.js';
import { operationalFiltersSchema } from './operational-filters.dto.js';

export const linelistExportQuerySchema = linelistProjectionSchema.and(
  operationalFiltersSchema,
);

export type LinelistExportQueryDto = z.infer<
  typeof linelistExportQuerySchema
>;
