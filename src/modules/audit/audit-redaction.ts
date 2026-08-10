import { createHash } from 'node:crypto';

import {
  CASE_INVESTIGATION_COLUMNS,
  COMMUNITY_SIGNAL_COLUMNS,
  CONTACT_REGISTRATION_COLUMNS,
  LAB_RESULT_COLUMNS,
  SCREENING_COLUMNS,
  TREATMENT_OUTCOME_COLUMNS,
} from '../operational/column-registry.js';

const CLOSED_FILTER_KEYS = [
  'period',
  'sortDir',
  'screeningScope',
  'screeningFlagged',
  'signalVerified',
] as const;

const DATE_BOUND_KEYS = ['from', 'to'] as const;

const DATE_BOUND =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?$/;

const FREE_TEXT_FILTER_KEYS = [
  'lab',
  'poe',
  'facility',
  'ageGroup',
  'signalStatus',
  'signalType',
  'communitySource',
  'classification',
  'resultStatus',
  'initialClassification',
  'specimenType',
  'testName',
  'turnaroundBand',
  'screeningOutcome',
  'screeningCategory',
  'treatmentOutcome',
] as const;

const REGISTRY_COLUMNS: ReadonlySet<string> = new Set([
  ...Object.keys(LAB_RESULT_COLUMNS),
  ...Object.keys(SCREENING_COLUMNS),
  ...Object.keys(CASE_INVESTIGATION_COLUMNS),
  ...Object.keys(TREATMENT_OUTCOME_COLUMNS),
  ...Object.keys(CONTACT_REGISTRATION_COLUMNS),
  ...Object.keys(COMMUNITY_SIGNAL_COLUMNS),
]);

export const REDACTION_LENGTH_SUFFIX = 'Length';
export const REDACTION_DIGEST_SUFFIX = 'Sha256';

function digestInto(
  target: Record<string, unknown>,
  key: string,
  value: string,
): void {
  target[`${key}${REDACTION_LENGTH_SUFFIX}`] = value.length;
  target[`${key}${REDACTION_DIGEST_SUFFIX}`] = createHash('sha256')
    .update(value)
    .digest('hex');
}

export function redactAuditFilters(
  query?: Record<string, unknown> | null,
): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  if (query === undefined || query === null) return redacted;

  for (const key of CLOSED_FILTER_KEYS) {
    const value = query[key];
    if (value !== undefined) redacted[key] = value;
  }

  for (const key of DATE_BOUND_KEYS) {
    const value = query[key];
    if (typeof value !== 'string' || value.length === 0) continue;
    if (DATE_BOUND.test(value)) redacted[key] = value;
    else digestInto(redacted, key, value);
  }

  const sortBy = query.sortBy;
  if (typeof sortBy === 'string' && sortBy.length > 0) {
    if (REGISTRY_COLUMNS.has(sortBy)) redacted.sortBy = sortBy;
    else digestInto(redacted, 'sortBy', sortBy);
  }

  for (const key of FREE_TEXT_FILTER_KEYS) {
    const value = query[key];
    if (typeof value !== 'string' || value.length === 0) continue;
    digestInto(redacted, key, value);
  }

  const term = query.q;
  if (typeof term === 'string' && term.length > 0) {
    digestInto(redacted, 'q', term);
  }

  return redacted;
}
