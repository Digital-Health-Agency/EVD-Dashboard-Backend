import { z } from 'zod';

export const periodValues = [
  '24h',
  '7d',
  '21d',
  '42d',
  'all',
  'custom',
] as const;

export const periodSchema = z.enum(periodValues);

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;

const boundSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .refine((value) => DATE_ONLY.test(value) || !Number.isNaN(Date.parse(value)), {
    message: 'Expected a YYYY-MM-DD date or an ISO 8601 date-time',
  });

const filterValueSchema = z.string().trim().min(1).max(180).optional();

function widen(value: string | undefined, edge: 'start' | 'end') {
  if (value === undefined || !DATE_ONLY.test(value)) return value;
  return edge === 'start' ? `${value} 00:00:00` : `${value} 23:59:59.999`;
}

function comparable(value: string | undefined): number {
  if (value === undefined) return Number.NaN;
  return Date.parse(value.includes('T') ? value : value.replace(' ', 'T'));
}

export const operationalFiltersSchema = z
  .object({
    period: periodSchema.default('21d'),
    from: boundSchema.optional(),
    to: boundSchema.optional(),

    lab: filterValueSchema,
    poe: filterValueSchema,
    facility: filterValueSchema,
    ageGroup: filterValueSchema,
    signalStatus: filterValueSchema,
    signalType: filterValueSchema,
    communitySource: filterValueSchema,
    classification: filterValueSchema,

    resultStatus: filterValueSchema,
    initialClassification: filterValueSchema,
    specimenType: filterValueSchema,
    testName: filterValueSchema,
    turnaroundBand: filterValueSchema,
    screeningOutcome: filterValueSchema,
    screeningCategory: filterValueSchema,
    screeningScope: z.literal('facility').optional(),
    screeningFlagged: z.literal('true').optional(),
    signalVerified: z.literal('true').optional(),
    treatmentOutcome: filterValueSchema,
  })
  .transform((filters) => ({
    ...filters,
    from: widen(filters.from, 'start'),
    to: widen(filters.to, 'end'),
  }))
  .superRefine((filters, ctx) => {
    if (filters.period !== 'custom') {
      for (const bound of ['from', 'to'] as const) {
        if (filters[bound] !== undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [bound],
            message: `${bound} is only accepted when period is custom`,
          });
        }
      }
      return;
    }

    for (const bound of ['from', 'to'] as const) {
      if (filters[bound] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [bound],
          message: `${bound} is required when period is custom`,
        });
      }
    }
    if (filters.from === undefined || filters.to === undefined) return;

    const from = comparable(filters.from);
    const to = comparable(filters.to);
    if (Number.isNaN(from) || Number.isNaN(to)) return;

    if (from > to) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'to must be on or after from',
      });
      return;
    }

    const spanDays = (to - from) / (24 * 3600 * 1000);
    if (spanDays > MAX_RANGE_DAYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: `A custom range may not exceed ${MAX_RANGE_DAYS} days`,
      });
    }
  });

export type OperationalPeriod = z.infer<typeof periodSchema>;
export type OperationalFiltersDto = z.infer<typeof operationalFiltersSchema>;
