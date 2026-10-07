export const HEADLINE_FIGURE_FIELDS = [
  'confirmed_cases',
  'confirmed_cases_24h',
  'recoveries',
  'deaths',
  'samples_tested_total',
  'samples_tested_24h',
  'positive_samples',
  'negative_samples',
  'travellers_screened_total',
  'travellers_screened_24h',
  'screening_points',
  'contacts_listed',
] as const;

export type HeadlineFigureKey = (typeof HEADLINE_FIGURE_FIELDS)[number];

export type HeadlineFigures = Record<HeadlineFigureKey, number | null>;

export const HEADLINE_OVERRIDE_TABLE = 'headline_overrides';

export const HEADLINE_OVERRIDE_EVENT = 'headline_override';

export class HeadlineOverrideRow {
  situation_date!: string;

  report_date!: string | null;

  source_label!: string | null;

  notes!: string | null;

  operational_override?: boolean;

  revision?: number;

  record_id?: string;

  confirmed_cases!: number | null;

  confirmed_cases_24h!: number | null;

  recoveries!: number | null;

  deaths!: number | null;

  samples_tested_total!: number | null;

  samples_tested_24h!: number | null;

  positive_samples!: number | null;

  negative_samples!: number | null;

  travellers_screened_total!: number | null;

  travellers_screened_24h!: number | null;

  screening_points!: number | null;

  contacts_listed!: number | null;

  updatedBy!: string | null;

  createdAt?: Date | string;

  updatedAt?: Date | string;
}
