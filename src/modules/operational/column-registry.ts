import { formatFor, labelFor, type ColumnFormat } from './column-labels.js';

export type Exposure = 'public' | 'authenticated' | 'pii';

export interface ColumnSpec {
  readonly column: string;
  readonly exposure: Exposure;
  readonly sortable: boolean;
  readonly byDefault: boolean;
  readonly searchable: boolean;
}

export type DatasetRegistry = Readonly<Record<string, ColumnSpec>>;

export const LAB_RESULT_COLUMNS = Object.freeze({
  lab_result_key: {
    column: 'lab_result_key',
    exposure: 'authenticated',
    sortable: false,
    byDefault: false,
    searchable: false,
  },
  reporting_result_date: {
    column: 'reporting_result_date',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: false,
  },
  reporting_collection_date: {
    column: 'reporting_collection_date',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: false,
  },
  specimen_type: {
    column: 'specimen_type',
    exposure: 'authenticated',
    sortable: true,
    byDefault: true,
    searchable: true,
  },
  test_name: {
    column: 'test_name',
    exposure: 'authenticated',
    sortable: true,
    byDefault: true,
    searchable: true,
  },
  result_category: {
    column: 'result_category',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: true,
  },
  result_value: {
    column: 'result_value',
    exposure: 'authenticated',
    sortable: false,
    byDefault: true,
    searchable: false,
  },
  reporting_testing_laboratory_name: {
    column: 'reporting_testing_laboratory_name',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: true,
  },
  reporting_requesting_facility_mfl: {
    column: 'reporting_requesting_facility_mfl',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: false,
  },
  turnaround_time_days: {
    column: 'turnaround_time_days',
    exposure: 'authenticated',
    sortable: true,
    byDefault: true,
    searchable: false,
  },
  source_system: {
    column: 'source_system',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: false,
  },

  testing_laboratory_name: {
    column: 'testing_laboratory_name',
    exposure: 'public',
    sortable: true,
    byDefault: false,
    searchable: true,
  },
  testing_laboratory_code: {
    column: 'testing_laboratory_code',
    exposure: 'authenticated',
    sortable: false,
    byDefault: false,
    searchable: false,
  },
  test_code: {
    column: 'test_code',
    exposure: 'authenticated',
    sortable: false,
    byDefault: false,
    searchable: false,
  },
  turnaround_time_band: {
    column: 'turnaround_time_band',
    exposure: 'authenticated',
    sortable: true,
    byDefault: false,
    searchable: false,
  },
  result_unit: {
    column: 'result_unit',
    exposure: 'authenticated',
    sortable: false,
    byDefault: false,
    searchable: false,
  },
  collection_date: {
    column: 'collection_date',
    exposure: 'public',
    sortable: true,
    byDefault: false,
    searchable: false,
  },
  result_datetime: {
    column: 'result_datetime',
    exposure: 'public',
    sortable: true,
    byDefault: false,
    searchable: false,
  },

  subject_identifier: {
    column: 'subject_identifier',
    exposure: 'pii',
    sortable: false,
    byDefault: true,
    searchable: true,
  },
} as const satisfies Record<string, ColumnSpec>);

export const SCREENING_COLUMNS = Object.freeze({
  screening_key: {
    column: 'screening_key',
    exposure: 'authenticated',
    sortable: false,
    byDefault: false,
    searchable: false,
  },
  screening_date: {
    column: 'screening_date',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: false,
  },
  reporting_point_of_entry: {
    column: 'reporting_point_of_entry',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: true,
  },
  source_classification: {
    column: 'source_classification',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: true,
  },
  screening_outcome: {
    column: 'screening_outcome',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: true,
  },
  reporting_screening_category: {
    column: 'reporting_screening_category',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: false,
  },
  source_system: {
    column: 'source_system',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: false,
  },
  surveillance_pathway: {
    column: 'surveillance_pathway',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: false,
  },

  point_of_entry: {
    column: 'point_of_entry',
    exposure: 'public',
    sortable: true,
    byDefault: false,
    searchable: true,
  },
  screening_datetime: {
    column: 'screening_datetime',
    exposure: 'public',
    sortable: true,
    byDefault: false,
    searchable: false,
  },
  reporting_date: {
    column: 'reporting_date',
    exposure: 'public',
    sortable: true,
    byDefault: false,
    searchable: false,
  },
  reporting_epi_week_label: {
    column: 'reporting_epi_week_label',
    exposure: 'public',
    sortable: false,
    byDefault: false,
    searchable: false,
  },

  person_name: {
    column: 'person_name',
    exposure: 'pii',
    sortable: false,
    byDefault: true,
    searchable: true,
  },
  person_identifier: {
    column: 'person_identifier',
    exposure: 'pii',
    sortable: false,
    byDefault: true,
    searchable: true,
  },
} as const satisfies Record<string, ColumnSpec>);

export const CASE_INVESTIGATION_COLUMNS = Object.freeze({
  case_investigation_key: {
    column: 'case_investigation_key',
    exposure: 'authenticated',
    sortable: false,
    byDefault: false,
    searchable: false,
  },
  reporting_date: {
    column: 'reporting_date',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: false,
  },
  disease: {
    column: 'disease',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: false,
  },
  reporting_county: {
    column: 'reporting_county',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: true,
  },
  reporting_subcounty: {
    column: 'reporting_subcounty',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: true,
  },
  health_facility: {
    column: 'health_facility',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: true,
  },
  initial_classification: {
    column: 'initial_classification',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: false,
  },
  final_classification: {
    column: 'final_classification',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: true,
  },
  reporting_case_classification: {
    column: 'reporting_case_classification',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: false,
  },
  investigation_status: {
    column: 'investigation_status',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: false,
  },
  sample_collected_flag: {
    column: 'sample_collected_flag',
    exposure: 'authenticated',
    sortable: true,
    byDefault: true,
    searchable: false,
  },
  reporting_age_group: {
    column: 'reporting_age_group',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: false,
  },
  source_person_sex: {
    column: 'source_person_sex',
    exposure: 'authenticated',
    sortable: true,
    byDefault: true,
    searchable: false,
  },
  source_system: {
    column: 'source_system',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: false,
  },

  investigation_date: {
    column: 'investigation_date',
    exposure: 'public',
    sortable: true,
    byDefault: false,
    searchable: false,
  },
  investigation_datetime: {
    column: 'investigation_datetime',
    exposure: 'public',
    sortable: true,
    byDefault: false,
    searchable: false,
  },
  age_at_investigation: {
    column: 'age_at_investigation',
    exposure: 'authenticated',
    sortable: true,
    byDefault: false,
    searchable: false,
  },
  reporting_epi_week_label: {
    column: 'reporting_epi_week_label',
    exposure: 'public',
    sortable: false,
    byDefault: false,
    searchable: false,
  },

  source_person_name: {
    column: 'source_person_name',
    exposure: 'pii',
    sortable: false,
    byDefault: true,
    searchable: true,
  },
  source_person_identifier: {
    column: 'source_person_identifier',
    exposure: 'pii',
    sortable: false,
    byDefault: true,
    searchable: true,
  },
} as const satisfies Record<string, ColumnSpec>);

export const TREATMENT_OUTCOME_COLUMNS = Object.freeze({
  treatment_outcome_key: {
    column: 'treatment_outcome_key',
    exposure: 'authenticated',
    sortable: false,
    byDefault: false,
    searchable: false,
  },
  reporting_date: {
    column: 'reporting_date',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: false,
  },
  disease: {
    column: 'disease',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: false,
  },
  reporting_county: {
    column: 'reporting_county',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: true,
  },
  reporting_subcounty: {
    column: 'reporting_subcounty',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: true,
  },
  health_facility: {
    column: 'health_facility',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: true,
  },
  treatment_outcome: {
    column: 'treatment_outcome',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: false,
  },
  final_classification: {
    column: 'final_classification',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: true,
  },
  final_laboratory_result: {
    column: 'final_laboratory_result',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: false,
  },
  died_flag: {
    column: 'died_flag',
    exposure: 'authenticated',
    sortable: true,
    byDefault: true,
    searchable: false,
  },
  reporting_age_group: {
    column: 'reporting_age_group',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: false,
  },
  source_person_sex: {
    column: 'source_person_sex',
    exposure: 'authenticated',
    sortable: true,
    byDefault: true,
    searchable: false,
  },
  source_system: {
    column: 'source_system',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: false,
  },

  outcome_date: {
    column: 'outcome_date',
    exposure: 'public',
    sortable: true,
    byDefault: false,
    searchable: false,
  },
  outcome_recorded_datetime: {
    column: 'outcome_recorded_datetime',
    exposure: 'public',
    sortable: true,
    byDefault: false,
    searchable: false,
  },
  age_at_outcome: {
    column: 'age_at_outcome',
    exposure: 'authenticated',
    sortable: true,
    byDefault: false,
    searchable: false,
  },
  initial_classification: {
    column: 'initial_classification',
    exposure: 'public',
    sortable: true,
    byDefault: false,
    searchable: false,
  },
  outcome_validation_status: {
    column: 'outcome_validation_status',
    exposure: 'authenticated',
    sortable: true,
    byDefault: false,
    searchable: false,
  },
  reporting_epi_week_label: {
    column: 'reporting_epi_week_label',
    exposure: 'public',
    sortable: false,
    byDefault: false,
    searchable: false,
  },

  source_person_name: {
    column: 'source_person_name',
    exposure: 'pii',
    sortable: false,
    byDefault: true,
    searchable: true,
  },
  source_person_identifier: {
    column: 'source_person_identifier',
    exposure: 'pii',
    sortable: false,
    byDefault: true,
    searchable: true,
  },
} as const satisfies Record<string, ColumnSpec>);

export const CONTACT_REGISTRATION_COLUMNS = Object.freeze({
  contact_registration_key: {
    column: 'contact_registration_key',
    exposure: 'authenticated',
    sortable: false,
    byDefault: false,
    searchable: false,
  },
  registration_date: {
    column: 'registration_date',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: false,
  },
  disease: {
    column: 'disease',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: false,
  },
  reporting_county: {
    column: 'reporting_county',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: true,
  },
  reporting_subcounty: {
    column: 'reporting_subcounty',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: true,
  },
  health_facility: {
    column: 'health_facility',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: true,
  },
  initial_classification: {
    column: 'initial_classification',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: false,
  },
  final_classification: {
    column: 'final_classification',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: true,
  },
  sample_collected_flag: {
    column: 'sample_collected_flag',
    exposure: 'authenticated',
    sortable: true,
    byDefault: true,
    searchable: false,
  },
  reporting_age_group: {
    column: 'reporting_age_group',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: false,
  },
  source_contact_sex: {
    column: 'source_contact_sex',
    exposure: 'authenticated',
    sortable: true,
    byDefault: true,
    searchable: false,
  },
  source_system: {
    column: 'source_system',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: false,
  },

  registration_datetime: {
    column: 'registration_datetime',
    exposure: 'public',
    sortable: true,
    byDefault: false,
    searchable: false,
  },
  age_at_registration: {
    column: 'age_at_registration',
    exposure: 'authenticated',
    sortable: true,
    byDefault: false,
    searchable: false,
  },
  reporting_epi_week_label: {
    column: 'reporting_epi_week_label',
    exposure: 'public',
    sortable: false,
    byDefault: false,
    searchable: false,
  },

  source_contact_name: {
    column: 'source_contact_name',
    exposure: 'pii',
    sortable: false,
    byDefault: true,
    searchable: true,
  },
  source_contact_identifier: {
    column: 'source_contact_identifier',
    exposure: 'pii',
    sortable: false,
    byDefault: true,
    searchable: true,
  },
} as const satisfies Record<string, ColumnSpec>);

export const COMMUNITY_SIGNAL_COLUMNS = Object.freeze({
  community_signal_key: {
    column: 'community_signal_key',
    exposure: 'authenticated',
    sortable: false,
    byDefault: false,
    searchable: false,
  },
  created_date: {
    column: 'created_date',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: false,
  },
  source_system: {
    column: 'source_system',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: false,
  },
  county: {
    column: 'county',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: true,
  },
  subcounty: {
    column: 'subcounty',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: true,
  },
  community_unit: {
    column: 'community_unit',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: true,
  },
  unit_type: {
    column: 'unit_type',
    exposure: 'public',
    sortable: true,
    byDefault: false,
    searchable: false,
  },
  signal_verified: {
    column: 'signal_verified',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: false,
  },
  signal_verified_true: {
    column: 'signal_verified_true',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: false,
  },
  signal_investigated: {
    column: 'signal_investigated',
    exposure: 'public',
    sortable: true,
    byDefault: true,
    searchable: false,
  },
  signal_verification_date: {
    column: 'signal_verification_date',
    exposure: 'public',
    sortable: true,
    byDefault: false,
    searchable: false,
  },
  signal_investigation_date: {
    column: 'signal_investigation_date',
    exposure: 'public',
    sortable: true,
    byDefault: false,
    searchable: false,
  },
  epi_week_label: {
    column: 'epi_week_label',
    exposure: 'public',
    sortable: true,
    byDefault: false,
    searchable: false,
  },
  signal_description: {
    column: 'signal_description',
    exposure: 'pii',
    sortable: false,
    byDefault: true,
    searchable: true,
  },
} as const satisfies Record<string, ColumnSpec>);

export const DATASET_REGISTRIES = Object.freeze({
  labResults: LAB_RESULT_COLUMNS,
  screenings: SCREENING_COLUMNS,
  cases: CASE_INVESTIGATION_COLUMNS,
  outcomes: TREATMENT_OUTCOME_COLUMNS,
  contacts: CONTACT_REGISTRATION_COLUMNS,
  signals: COMMUNITY_SIGNAL_COLUMNS,
} as const satisfies Record<string, DatasetRegistry>);

export type DatasetKey = keyof typeof DATASET_REGISTRIES;

export type SortDirection = 'ASC' | 'DESC';

export interface ResolvedSort {
  readonly column: string;
  readonly direction: SortDirection;
}

const SORT_DIRECTIONS: Readonly<Record<string, SortDirection>> = Object.freeze({
  asc: 'ASC',
  desc: 'DESC',
});

function specFor(
  registry: DatasetRegistry,
  name: string,
): ColumnSpec | undefined {
  if (!Object.prototype.hasOwnProperty.call(registry, name)) return undefined;
  return registry[name];
}

export interface FieldAccess {
  readonly allowPii?: boolean;
}

export interface LinelistColumn {
  readonly name: string;
  readonly label: string;
  readonly sortable: boolean;
  readonly format: ColumnFormat;
}

function columnContract(name: string, spec: ColumnSpec): LinelistColumn {
  return {
    name,
    label: labelFor(name),
    sortable: spec.sortable,
    format: formatFor(name),
  };
}

function fieldPermitted(spec: ColumnSpec, access: FieldAccess): boolean {
  return spec.exposure !== 'pii' || access.allowPii === true;
}

export function requestedPiiColumns(
  registry: DatasetRegistry,
  requested?: readonly string[],
): string[] {
  if (!requested || requested.length === 0) return [];

  return requested
    .map((name) => specFor(registry, name))
    .filter((spec): spec is ColumnSpec => spec !== undefined)
    .filter((spec) => spec.exposure === 'pii')
    .map((spec) => spec.column);
}

export function resolveFields(
  registry: DatasetRegistry,
  requested?: readonly string[],
  access: FieldAccess = {},
): string[] {
  const base = Object.values(registry)
    .filter((spec) => spec.byDefault)
    .filter((spec) => fieldPermitted(spec, access))
    .map((spec) => spec.column);

  if (!requested || requested.length === 0) return base;

  const selected = requested
    .map((name) => specFor(registry, name))
    .filter((spec): spec is ColumnSpec => spec !== undefined)
    .filter((spec) => fieldPermitted(spec, access))
    .map((spec) => spec.column);

  const unique = [...new Set(selected)];
  return unique.length > 0 ? unique : base;
}

export function resolveColumnSpecs(
  registry: DatasetRegistry,
  requested?: readonly string[],
  access: FieldAccess = {},
): LinelistColumn[] {
  return resolveFields(registry, requested, access).map((name) => {
    const spec = specFor(registry, name);
    if (spec === undefined) {
      throw new Error(`Resolved linelist column is absent from its registry: ${name}`);
    }
    return columnContract(name, spec);
  });
}

export function resolveAvailableColumnSpecs(
  registry: DatasetRegistry,
  access: FieldAccess = {},
): LinelistColumn[] {
  return Object.entries(registry)
    .filter(([, spec]) => fieldPermitted(spec, access))
    .map(([name, spec]) => columnContract(name, spec));
}

export function resolveSort(
  registry: DatasetRegistry,
  sortBy: string | undefined,
  sortDir: string | undefined,
  fallbackColumn: string,
): ResolvedSort {
  const fallback: ResolvedSort = { column: fallbackColumn, direction: 'DESC' };

  if (typeof sortBy !== 'string' || sortBy.length === 0) return fallback;

  const spec = specFor(registry, sortBy);
  if (spec === undefined || !spec.sortable) return fallback;

  const direction =
    typeof sortDir === 'string' ? SORT_DIRECTIONS[sortDir] : undefined;
  if (direction === undefined) return fallback;

  return { column: spec.column, direction };
}

export function searchableColumns(registry: DatasetRegistry): string[] {
  return Object.values(registry)
    .filter((spec) => spec.searchable)
    .map((spec) => spec.column);
}

export function piiColumns(registry: DatasetRegistry): string[] {
  return Object.values(registry)
    .filter((spec) => spec.exposure === 'pii')
    .map((spec) => spec.column);
}
