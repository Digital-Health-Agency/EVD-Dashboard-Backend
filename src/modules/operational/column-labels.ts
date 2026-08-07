export const COLUMN_LABELS: Readonly<Record<string, string>> = Object.freeze({
  lab_result_key: 'Record ID',
  reporting_result_date: 'Result date',
  reporting_collection_date: 'Collection date',
  specimen_type: 'Specimen type',
  test_name: 'Test name',
  result_category: 'Result category',
  result_value: 'Result value',
  reporting_testing_laboratory_name: 'Testing laboratory',
  reporting_requesting_facility_mfl: 'Requesting facility MFL',
  turnaround_time_days: 'Turnaround (days)',
  source_system: 'Source system',
  testing_laboratory_name: 'Laboratory name',
  testing_laboratory_code: 'Laboratory code',
  test_code: 'Test code',
  turnaround_time_band: 'Turnaround band',
  result_unit: 'Result unit',
  collection_date: 'Source collection date',
  result_datetime: 'Result date and time',
  subject_identifier: 'Subject identifier',
  screening_key: 'Record ID',
  screening_date: 'Screening date',
  reporting_point_of_entry: 'Point of entry',
  source_classification: 'Source classification',
  screening_outcome: 'Screening outcome',
  reporting_screening_category: 'Screening category',
  surveillance_pathway: 'Surveillance pathway',
  point_of_entry: 'Source point of entry',
  screening_datetime: 'Screening date and time',
  reporting_date: 'Reporting date',
  reporting_epi_week_label: 'Epidemiological week',
  source_person_name: 'Person name',
  person_name: 'Person name',
  person_identifier: 'Person identifier',
  source_person_identifier: 'Person identifier',
  case_investigation_key: 'Record ID',
  disease: 'Disease',
  reporting_county: 'County',
  reporting_subcounty: 'Subcounty',
  health_facility: 'Health facility',
  initial_classification: 'Initial classification',
  final_classification: 'Final classification',
  reporting_case_classification: 'Case classification',
  investigation_status: 'Investigation status',
  sample_collected_flag: 'Sample collected',
  reporting_age_group: 'Age group',
  source_person_sex: 'Sex',
  investigation_date: 'Investigation date',
  investigation_datetime: 'Investigation date and time',
  age_at_investigation: 'Age at investigation',
  treatment_outcome_key: 'Record ID',
  treatment_outcome: 'Treatment outcome',
  final_laboratory_result: 'Final laboratory result',
  died_flag: 'Died',
  outcome_date: 'Outcome date',
  outcome_recorded_datetime: 'Outcome recorded date and time',
  age_at_outcome: 'Age at outcome',
  outcome_validation_status: 'Outcome validation status',
  contact_registration_key: 'Record ID',
  registration_date: 'Registration date',
  source_contact_sex: 'Contact sex',
  registration_datetime: 'Registration date and time',
  age_at_registration: 'Age at registration',
  source_contact_name: 'Contact name',
  source_contact_identifier: 'Contact identifier',
  community_signal_key: 'Record ID',
  created_date: 'Signal date',
  county: 'County',
  subcounty: 'Subcounty',
  community_unit: 'Community unit',
  unit_type: 'Unit type',
  signal_verification_date: 'Verification date',
  signal_investigation_date: 'Investigation date',
  signal_verified: 'Verified',
  signal_verified_true: 'Verified true',
  signal_investigated: 'Investigated',
  epi_week_label: 'Epidemiological week',
  signal_description: 'Signal description',
});

export function labelFor(column: string): string {
  if (!Object.prototype.hasOwnProperty.call(COLUMN_LABELS, column)) {
    throw new Error(`No display label registered for linelist column: ${column}`);
  }
  return COLUMN_LABELS[column];
}

export type ColumnFormat =
  | 'date'
  | 'datetime'
  | 'number'
  | 'status'
  | 'identifier'
  | 'boolean'
  | 'text';

export const COLUMN_FORMATS: Readonly<Record<string, ColumnFormat>> =
  Object.freeze({
    reporting_result_date: 'date',
    reporting_collection_date: 'date',
    collection_date: 'date',
    screening_date: 'date',
    reporting_date: 'date',
    investigation_date: 'date',
    outcome_date: 'date',
    registration_date: 'date',
    created_date: 'date',
    signal_verification_date: 'date',
    signal_investigation_date: 'date',

    result_datetime: 'datetime',
    screening_datetime: 'datetime',
    investigation_datetime: 'datetime',
    outcome_recorded_datetime: 'datetime',
    registration_datetime: 'datetime',

    lab_result_key: 'identifier',
    screening_key: 'identifier',
    case_investigation_key: 'identifier',
    treatment_outcome_key: 'identifier',
    contact_registration_key: 'identifier',
    community_signal_key: 'identifier',
    subject_identifier: 'identifier',
    source_person_identifier: 'identifier',
    person_identifier: 'identifier',
    source_contact_identifier: 'identifier',
    testing_laboratory_code: 'identifier',
    test_code: 'identifier',
    reporting_requesting_facility_mfl: 'identifier',

    sample_collected_flag: 'boolean',
    died_flag: 'boolean',
    signal_verified: 'boolean',
    signal_verified_true: 'boolean',
    signal_investigated: 'boolean',

    turnaround_time_days: 'number',
    age_at_investigation: 'number',
    age_at_outcome: 'number',
    age_at_registration: 'number',

    result_category: 'status',
    screening_outcome: 'status',
    source_classification: 'status',
    initial_classification: 'status',
    final_classification: 'status',
    reporting_case_classification: 'status',
    investigation_status: 'status',
    treatment_outcome: 'status',
    final_laboratory_result: 'status',
  });

export function formatFor(column: string): ColumnFormat {
  if (!Object.prototype.hasOwnProperty.call(COLUMN_FORMATS, column)) {
    return 'text';
  }
  return COLUMN_FORMATS[column];
}
