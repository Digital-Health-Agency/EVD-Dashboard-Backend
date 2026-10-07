import { z } from 'zod';

import { nairobiToday } from '../../../common/nairobi-date.js';
import {
  HEADLINE_FIGURE_FIELDS,
  type HeadlineFigureKey,
} from '../headline-override.schema.js';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_FIGURE = 2_147_483_647;

function isCalendarDate(value: string): boolean {
  const time = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(time)) return false;
  return new Date(time).toISOString().slice(0, 10) === value;
}

export const dateOnlySchema = z
  .string()
  .trim()
  .regex(DATE_ONLY, { message: 'Expected a YYYY-MM-DD date' })
  .refine(isCalendarDate, { message: 'Expected a real calendar date' });

export const newSituationDateSchema = dateOnlySchema.refine(
  (value) => !isCalendarDate(value) || value <= nairobiToday(),
  { message: 'Situation date cannot be in the future' },
);

export const figureSchema = z.number().int().min(0).max(MAX_FIGURE).nullable();

const optionalFigureSchema = figureSchema.optional();

const figureShape = Object.fromEntries(
  HEADLINE_FIGURE_FIELDS.map((key) => [key, optionalFigureSchema]),
) as Record<HeadlineFigureKey, typeof optionalFigureSchema>;

export const createHeadlineOverrideSchema = z
  .object({
    situation_date: newSituationDateSchema,
    report_date: dateOnlySchema.nullable().optional(),
    source_label: z.string().trim().max(200).nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    operational_override: z.boolean().optional(),
    ...figureShape,
  })
  .strict();

export const updateHeadlineOverrideSchema = createHeadlineOverrideSchema
  .omit({ situation_date: true })
  .extend({
    expected_revision: z.number().int().min(1),
    expected_record_id: z.string().min(1).max(100),
  })
  .strict();

export const deleteHeadlineOverrideSchema = z
  .object({
    expected_revision: z.coerce.number().int().min(1),
    expected_record_id: z.string().min(1).max(100),
  })
  .strict();

export const situationDateParamSchema = dateOnlySchema;

export type CreateHeadlineOverrideDto = z.infer<
  typeof createHeadlineOverrideSchema
>;
export type UpdateHeadlineOverrideDto = z.infer<
  typeof updateHeadlineOverrideSchema
>;
