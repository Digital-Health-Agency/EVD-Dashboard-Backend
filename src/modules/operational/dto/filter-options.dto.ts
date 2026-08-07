import { z } from 'zod';

export const operationalTabValues = [
  'summary',
  'labs',
  'poe',
  'hf',
  'community',
  'contacts',
] as const;

export const filterOptionsQuerySchema = z.object({
  tab: z.enum(operationalTabValues),
});

export type OperationalTab = (typeof operationalTabValues)[number];
export type FilterOptionsQueryDto = z.infer<typeof filterOptionsQuerySchema>;
