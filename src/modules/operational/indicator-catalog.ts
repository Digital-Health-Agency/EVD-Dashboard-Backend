import type {
  DataQualityStatus,
  IndicatorMeta,
  SecurityClassification,
} from './tab-payload.js';

export interface IndicatorCatalogEntry {
  indicatorId: string;
  displayName: string;
  securityClassification: SecurityClassification;
  baselineQualityStatus: DataQualityStatus;
  definition?: string;
  countingUnit?: string;
  sourceSystem?: string[];
  coverage?: string;
  refreshFrequency?: string;
  allowedFilters?: string[];
  breakdown?: string[];
}

const LAB_ALLOWED_FILTERS = [
  'period',
  'lab',
  'resultStatus',
  'specimenType',
  'testName',
  'turnaroundBand',
];

const POE_ALLOWED_FILTERS = [
  'period',
  'poe',
  'screeningOutcome',
  'screeningCategory',
];

const HF_ALLOWED_FILTERS = ['period', 'facility'];

const CONTACT_ALLOWED_FILTERS = ['period', 'classification'];

const COMMUNITY_ALLOWED_FILTERS = ['period', 'communitySource'];

const SUMMARY_ALLOWED_FILTERS = ['period'];

const RESTRICTED: SecurityClassification = 'restricted aggregate';

const LAB_BASELINE: DataQualityStatus = 'provisional';

const POE_BASELINE: DataQualityStatus = 'provisional';

const HF_BASELINE: DataQualityStatus = 'provisional';

const CONTACT_BASELINE: DataQualityStatus = 'provisional';

const COMMUNITY_BASELINE: DataQualityStatus = 'provisional';

const COMMUNITY_COVERAGE =
  'Communities reporting through the mDharura community-based surveillance system';

export const INDICATOR_CATALOG: Readonly<
  Record<string, IndicatorCatalogEntry>
> = Object.freeze({
  'labs.testsDone': {
    indicatorId: 'labs.testsDone',
    displayName: 'No. of tests done',
    definition:
      'Laboratory tests recorded for the EVD test code within the selected window, counted from total_test_count on gold.report_lab_result.',
    countingUnit: 'laboratory test events',
    sourceSystem: ['LIMS'],
    refreshFrequency: 'Daily',
    allowedFilters: LAB_ALLOWED_FILTERS,
    securityClassification: RESTRICTED,
    baselineQualityStatus: LAB_BASELINE,
  },
  'labs.positiveTests': {
    indicatorId: 'labs.positiveTests',
    displayName: 'No. of positive tests',
    definition:
      'Laboratory tests whose result_category is POSITIVE within the selected window, counted from positive_test_count on gold.report_lab_result.',
    countingUnit: 'laboratory test events',
    sourceSystem: ['LIMS'],
    refreshFrequency: 'Daily',
    allowedFilters: LAB_ALLOWED_FILTERS,
    securityClassification: RESTRICTED,
    baselineQualityStatus: LAB_BASELINE,
  },
  'labs.negativeTests': {
    indicatorId: 'labs.negativeTests',
    displayName: 'No. of negative tests',
    definition:
      'Laboratory test events in the selected window that gold did not record as POSITIVE, derived as total_test_count minus positive_test_count on gold.report_lab_result. Inconclusive, other, unknown and awaited results are all counted here, so Tests Done always equals Positive plus Negative.',
    countingUnit: 'laboratory test events',
    sourceSystem: ['LIMS'],
    refreshFrequency: 'Daily',
    allowedFilters: LAB_ALLOWED_FILTERS,
    securityClassification: RESTRICTED,
    baselineQualityStatus: LAB_BASELINE,
  },
  'labs.resultStatusChart': {
    indicatorId: 'labs.resultStatusChart',
    displayName: 'Laboratory result status',
    definition:
      'Laboratory test events in the selected window split positive versus negative, where negative is every event not recorded POSITIVE.',
    countingUnit: 'laboratory test events',
    sourceSystem: ['LIMS'],
    refreshFrequency: 'Daily',
    allowedFilters: LAB_ALLOWED_FILTERS,
    breakdown: ['result category'],
    securityClassification: RESTRICTED,
    baselineQualityStatus: LAB_BASELINE,
  },
  'labs.byLaboratory': {
    indicatorId: 'labs.byLaboratory',
    displayName: 'Tests by testing laboratory',
    definition:
      'Laboratory tests in the selected window grouped by the testing laboratory that produced the result, which gold captures separately from the requesting facility.',
    countingUnit: 'laboratory test events',
    sourceSystem: ['LIMS'],
    refreshFrequency: 'Daily',
    allowedFilters: LAB_ALLOWED_FILTERS,
    breakdown: ['testing laboratory'],
    securityClassification: RESTRICTED,
    baselineQualityStatus: LAB_BASELINE,
  },

  'poe.travellersScreened': {
    indicatorId: 'poe.travellersScreened',
    displayName: 'No. screened',
    definition:
      'Traveller screenings recorded at a point of entry within the selected window, counted from total_screening_count on gold.report_screening.',
    countingUnit: 'screenings',
    sourceSystem: ['ADAM'],
    refreshFrequency: 'Near real-time',
    allowedFilters: POE_ALLOWED_FILTERS,
    securityClassification: RESTRICTED,
    baselineQualityStatus: POE_BASELINE,
  },
  'poe.byPointOfEntry': {
    indicatorId: 'poe.byPointOfEntry',
    displayName: 'Screenings by point of entry',
    definition:
      'Screenings in the selected window, grouped by the point of entry that recorded them, and scoped to the traveller surveillance pathway so facility screenings in the same mart are excluded. Secondary alerts and suspected-or-probable classifications were removed from this surface by owner ruling on 2026-08-06; the tab reports screening workload alone.',
    countingUnit: 'screenings',
    sourceSystem: ['ADAM'],
    refreshFrequency: 'Near real-time',
    allowedFilters: POE_ALLOWED_FILTERS,
    breakdown: ['point of entry'],
    securityClassification: RESTRICTED,
    baselineQualityStatus: POE_BASELINE,
  },

  'hf.screened': {
    indicatorId: 'hf.screened',
    displayName: 'Screened',
    definition:
      'TAIFACARE_KENYAEMR facility screenings recorded within the selected window, counted from total_screening_count on gold.report_screening.',
    countingUnit: 'screenings',
    sourceSystem: ['TAIFACARE_KENYAEMR'],
    refreshFrequency: 'Near real-time',
    allowedFilters: HF_ALLOWED_FILTERS,
    securityClassification: RESTRICTED,
    baselineQualityStatus: HF_BASELINE,
  },
  'hf.alerts': {
    indicatorId: 'hf.alerts',
    displayName: 'Alerts',
    definition:
      'TAIFACARE_KENYAEMR facility screenings flagged for further action within the selected window, counted from flagged_screening_count on gold.report_screening.',
    countingUnit: 'screenings',
    sourceSystem: ['TAIFACARE_KENYAEMR'],
    refreshFrequency: 'Near real-time',
    allowedFilters: HF_ALLOWED_FILTERS,
    securityClassification: RESTRICTED,
    baselineQualityStatus: HF_BASELINE,
  },
  'hf.confirmed': {
    indicatorId: 'hf.confirmed',
    displayName: 'Confirmed',
    definition:
      'Fixed at zero by owner ruling; gold.report_screening does not carry a confirmed-case measure for TAIFACARE_KENYAEMR facility data.',
    countingUnit: 'cases',
    sourceSystem: ['TAIFACARE_KENYAEMR'],
    refreshFrequency: 'Near real-time',
    allowedFilters: HF_ALLOWED_FILTERS,
    securityClassification: RESTRICTED,
    baselineQualityStatus: HF_BASELINE,
  },
  'hf.currentAdmitted': {
    indicatorId: 'hf.currentAdmitted',
    displayName: 'Current admitted',
    definition:
      'Fixed at zero by owner ruling until a current-admissions measure is available for TAIFACARE_KENYAEMR facility data.',
    countingUnit: 'patients',
    sourceSystem: ['TAIFACARE_KENYAEMR'],
    refreshFrequency: 'Near real-time',
    allowedFilters: HF_ALLOWED_FILTERS,
    securityClassification: RESTRICTED,
    baselineQualityStatus: HF_BASELINE,
  },
  'hf.recovered': {
    indicatorId: 'hf.recovered',
    displayName: 'Recovered',
    definition:
      'Fixed at zero by owner ruling until a recovery measure is available for TAIFACARE_KENYAEMR facility data.',
    countingUnit: 'patients',
    sourceSystem: ['TAIFACARE_KENYAEMR'],
    refreshFrequency: 'Near real-time',
    allowedFilters: HF_ALLOWED_FILTERS,
    securityClassification: RESTRICTED,
    baselineQualityStatus: HF_BASELINE,
  },
  'hf.deaths': {
    indicatorId: 'hf.deaths',
    displayName: 'Deaths',
    definition:
      'Fixed at zero by owner ruling until a deaths measure is available for TAIFACARE_KENYAEMR facility data.',
    countingUnit: 'patients',
    sourceSystem: ['TAIFACARE_KENYAEMR'],
    refreshFrequency: 'Near real-time',
    allowedFilters: HF_ALLOWED_FILTERS,
    securityClassification: RESTRICTED,
    baselineQualityStatus: HF_BASELINE,
  },
  'hf.byFacility': {
    indicatorId: 'hf.byFacility',
    displayName: 'Screenings, alerts and confirmed by facility',
    definition:
      'TAIFACARE_KENYAEMR facility screenings grouped by reporting facility, showing measured screening volume and alerts alongside confirmed cases fixed at zero.',
    countingUnit: 'screenings',
    sourceSystem: ['TAIFACARE_KENYAEMR'],
    refreshFrequency: 'Near real-time',
    allowedFilters: HF_ALLOWED_FILTERS,
    breakdown: ['facility'],
    securityClassification: RESTRICTED,
    baselineQualityStatus: HF_BASELINE,
  },

  'contacts.contactsListed': {
    indicatorId: 'contacts.contactsListed',
    displayName: 'Contacts listed',
    definition:
      'Contacts registered within the selected window, counted from total_contact_registration_count on gold.report_contact_registration.',
    countingUnit: 'contact registrations',
    sourceSystem: ['ADAM'],
    allowedFilters: CONTACT_ALLOWED_FILTERS,
    securityClassification: RESTRICTED,
    baselineQualityStatus: CONTACT_BASELINE,
  },
  'contacts.byCounty': {
    indicatorId: 'contacts.byCounty',
    displayName: 'Contacts listed by county',
    definition:
      'Contacts registered within the selected window, grouped by the reporting county on gold.report_contact_registration.',
    countingUnit: 'contact registrations',
    sourceSystem: ['ADAM'],
    allowedFilters: CONTACT_ALLOWED_FILTERS,
    breakdown: ['county'],
    securityClassification: RESTRICTED,
    baselineQualityStatus: CONTACT_BASELINE,
  },

  'community.signalsReported': {
    indicatorId: 'community.signalsReported',
    displayName: 'Signals reported',
    definition:
      'Community signals reported within the selected window, counted from total_signal_count on gold.report_community_signals. One row is one signal, so this is a count of signals rather than of reporting events. Scope is the two EVD-specific CEBS signals — a cross-border traveller with symptoms, and a contact of a person with similar symptoms — so this is a count of EVD signals, never a total of all community signals raised.',
    countingUnit: 'signals',
    sourceSystem: ['MDHARURA'],
    coverage: COMMUNITY_COVERAGE,
    refreshFrequency: 'Daily',
    allowedFilters: COMMUNITY_ALLOWED_FILTERS,
    securityClassification: RESTRICTED,
    baselineQualityStatus: COMMUNITY_BASELINE,
  },
  'community.signalsVerified': {
    indicatorId: 'community.signalsVerified',
    displayName: 'Signals verified',
    definition:
      'Signals that reached the VERIFIED rung within the selected window, counted from signals_verified on gold.report_community_signals. The card reports this COUNT; the share of signals reported is carried beneath it as secondary text, and is omitted rather than shown as zero per cent when no signal falls in scope, since a ratio over an empty set is undefined rather than zero.',
    countingUnit: 'signals',
    sourceSystem: ['MDHARURA'],
    coverage: COMMUNITY_COVERAGE,
    refreshFrequency: 'Daily',
    allowedFilters: COMMUNITY_ALLOWED_FILTERS,
    securityClassification: RESTRICTED,
    baselineQualityStatus: COMMUNITY_BASELINE,
  },
  'community.byCounty': {
    indicatorId: 'community.byCounty',
    displayName: 'Signals by county',
    definition:
      'Signals reported and signals verified within the selected window, grouped by the reporting county conformed through dim_location. County replaces the signal-type grouping this carried before the upstream ETL revert, which removed signal_type from the mart outright. No investigated-signal figure is carried: D-24R and D-33 define this surface as the reported-and-verified pair, and surfacing a third measure would be a scope decision rather than a column discovery.',
    countingUnit: 'signals',
    sourceSystem: ['MDHARURA'],
    coverage: COMMUNITY_COVERAGE,
    refreshFrequency: 'Daily',
    allowedFilters: COMMUNITY_ALLOWED_FILTERS,
    breakdown: ['county'],
    securityClassification: RESTRICTED,
    baselineQualityStatus: COMMUNITY_BASELINE,
  },

  'summary.alerts': {
    indicatorId: 'summary.alerts',
    displayName: 'Alerts',
    definition:
      'Case investigations opened as suspected or probable within the selected window: the total of initial_suspected_count and initial_probable_count on gold.report_case_investigation. The card carries the total alone — the two rungs were dropped from the payload on 2026-08-06 at the reader’s request, so nothing downstream can render them. This is not a pending-investigation queue — no such entity exists in the warehouse.',
    countingUnit: 'case investigations',
    sourceSystem: ['ADAM'],
    refreshFrequency: 'Daily',
    allowedFilters: SUMMARY_ALLOWED_FILTERS,
    securityClassification: RESTRICTED,
    baselineQualityStatus: HF_BASELINE,
  },
  'summary.confirmedCases': {
    indicatorId: 'summary.confirmedCases',
    displayName: 'Confirmed cases',
    definition:
      'Case investigations finally classified confirmed within the selected window, counted from final_confirmed_count on gold.report_case_investigation. Measured at zero on the current warehouse, which is a real aggregate over a populated mart and renders as zero rather than as a dash.',
    countingUnit: 'case investigations',
    sourceSystem: ['ADAM'],
    refreshFrequency: 'Daily',
    allowedFilters: SUMMARY_ALLOWED_FILTERS,
    securityClassification: RESTRICTED,
    baselineQualityStatus: HF_BASELINE,
  },
  'summary.deaths': {
    indicatorId: 'summary.deaths',
    displayName: 'Deaths',
    definition:
      'Treatment outcomes recorded as deceased within the selected window, counted from deceased_count on gold.report_treatment_outcome. Measured at zero on the current warehouse and rendered as zero. The card carries a case fatality rate beneath the count: the same deaths over final_confirmed_count on gold.report_case_investigation, expressed as a percentage to one decimal. Numerator and denominator are the same expressions this card and the Confirmed cases card use, so the rate reconciles to both under identical filters. The two measures come from separate marts and are not linked case-by-case, so a death and the confirmation it belongs to can fall in different windows — the rate is a window ratio, not a cohort-followed outcome. Where no confirmed case falls in the window the rate is undefined and renders as a dash rather than zero.',
    countingUnit: 'treatment outcomes',
    sourceSystem: ['ADAM'],
    refreshFrequency: 'Daily',
    allowedFilters: SUMMARY_ALLOWED_FILTERS,
    securityClassification: RESTRICTED,
    baselineQualityStatus: HF_BASELINE,
  },
  'summary.currentAdmitted': {
    indicatorId: 'summary.currentAdmitted',
    displayName: 'Current admitted',
    definition:
      'Confirmed or probable cases currently admitted. Fixed at zero by owner ruling until an admission measure is available: no gold report mart carries one of any kind, so the zero is a placeholder and not a measured count. Nothing on the card itself says so — the detail line describes the indicator rather than its availability, matching its siblings — so this entry is the only record of it. It remains deliberately NOT derived from on_treatment_count on gold.report_treatment_outcome: a treatment status is not an admission fact, and reporting one under this label would answer a different question. The card is filed against gold.report_treatment_outcome because that is the mart a real admission measure would land in, matching how the Health Facilities tab files its own fixed zeros.',
    countingUnit: 'case investigations',
    sourceSystem: ['ADAM'],
    refreshFrequency: 'Daily',
    allowedFilters: SUMMARY_ALLOWED_FILTERS,
    securityClassification: RESTRICTED,
    baselineQualityStatus: HF_BASELINE,
  },
  'summary.recovered': {
    indicatorId: 'summary.recovered',
    displayName: 'Recoveries',
    definition:
      'Treatment outcomes recorded as recovered within the selected window, counted from recovered_count on gold.report_treatment_outcome. Measured at zero on the current warehouse and rendered as zero.',
    countingUnit: 'treatment outcomes',
    sourceSystem: ['ADAM'],
    refreshFrequency: 'Daily',
    allowedFilters: SUMMARY_ALLOWED_FILTERS,
    securityClassification: RESTRICTED,
    baselineQualityStatus: HF_BASELINE,
  },
  'summary.dailyFlow': {
    indicatorId: 'summary.dailyFlow',
    displayName: 'Daily signal and sample flow',
    definition:
      'Signals reported, signals verified and laboratory samples per day across the selected window. Signals come from gold.report_community_signals on its reporting date and samples from gold.report_lab_result on its reporting collection date. Days are emitted from a generated series, so a day inside the window with no records carries zero rather than being dropped from the axis. The two signal series — and only those two, not the sample series beside them — carry the community mart scope: the two EVD-specific CEBS signals, a cross-border traveller with symptoms and a contact of a person with similar symptoms.',
    countingUnit: 'signals and laboratory test events per day',
    sourceSystem: ['MDHARURA', 'LIMS'],
    refreshFrequency: 'Daily',
    allowedFilters: SUMMARY_ALLOWED_FILTERS,
    breakdown: ['day'],
    securityClassification: RESTRICTED,
    baselineQualityStatus: COMMUNITY_BASELINE,
  },
  'summary.sampleStatus': {
    indicatorId: 'summary.sampleStatus',
    displayName: 'Result status',
    definition:
      'Laboratory tests in the selected window split by the result buckets gold actually produces. A bucket is rendered only where gold produces it; no PENDING or INCONCLUSIVE category is synthesised.',
    countingUnit: 'laboratory test events',
    sourceSystem: ['LIMS'],
    refreshFrequency: 'Daily',
    allowedFilters: SUMMARY_ALLOWED_FILTERS,
    breakdown: ['result category'],
    securityClassification: RESTRICTED,
    baselineQualityStatus: LAB_BASELINE,
  },
  'summary.facilityBreakdown': {
    indicatorId: 'summary.facilityBreakdown',
    displayName: 'Cases by health facility',
    definition:
      'Alerts, confirmations, recoveries and deaths grouped by the facility that reported them, joined across gold.report_case_investigation and gold.report_treatment_outcome on health_facility. The four measures are the same expressions the Alerts, Confirmed cases, Recoveries and Deaths cards use, so the column totals reconcile to those cards under identical filters. Activity carrying no recorded facility is aggregated into a single Not recorded row sorted last — that row is what makes the reconciliation hold, since the cards count the activity whether or not a facility was recorded. Facilities with no activity in the window produce no row. Where the row count exceeds the display limit the table reports the total beside the number shown, which is the only case in which the visible totals fall short of the cards.',
    countingUnit: 'case investigations',
    sourceSystem: ['ADAM'],
    refreshFrequency: 'Daily',
    allowedFilters: SUMMARY_ALLOWED_FILTERS,
    breakdown: ['health facility'],
    securityClassification: RESTRICTED,
    baselineQualityStatus: HF_BASELINE,
  },
});

export type IndicatorRuntimeMeta = {
  periodStart?: string | null;
  periodEnd?: string | null;
  lastUpdated?: string | null;
  pending?: boolean;
  incomplete?: boolean;
};

export function catalogEntry(
  indicatorId: string,
): IndicatorCatalogEntry | undefined {
  return INDICATOR_CATALOG[indicatorId];
}

export function catalogSources(
  indicatorIds: readonly string[],
): string[] | undefined {
  const sources: string[] = [];

  for (const indicatorId of indicatorIds) {
    const declared = INDICATOR_CATALOG[indicatorId]?.sourceSystem;
    if (declared === undefined || declared.length === 0) return undefined;
    for (const system of declared) {
      if (!sources.includes(system)) sources.push(system);
    }
  }

  return sources.length > 0 ? sources : undefined;
}

function resolveQualityStatus(
  entry: IndicatorCatalogEntry,
  runtime: IndicatorRuntimeMeta,
): DataQualityStatus {
  if (runtime.pending) return 'unavailable';
  if (runtime.incomplete) return 'incomplete';

  return entry.baselineQualityStatus;
}

export function withRuntimeMeta(
  entry: IndicatorCatalogEntry | undefined,
  runtime: IndicatorRuntimeMeta = {},
): IndicatorMeta | undefined {
  if (!entry) return undefined;

  const meta: IndicatorMeta = {
    indicatorId: entry.indicatorId,
    displayName: entry.displayName,
    securityClassification: entry.securityClassification,
    dataQualityStatus: resolveQualityStatus(entry, runtime),
  };

  if (entry.definition !== undefined) meta.definition = entry.definition;
  if (entry.countingUnit !== undefined) meta.countingUnit = entry.countingUnit;
  if (entry.sourceSystem !== undefined) meta.sourceSystem = entry.sourceSystem;
  if (entry.coverage !== undefined) meta.coverage = entry.coverage;
  if (entry.refreshFrequency !== undefined) {
    meta.refreshFrequency = entry.refreshFrequency;
  }
  if (entry.allowedFilters !== undefined) {
    meta.allowedFilters = entry.allowedFilters;
  }
  if (entry.breakdown !== undefined) meta.breakdown = entry.breakdown;
  if (runtime.periodStart !== undefined) meta.periodStart = runtime.periodStart;
  if (runtime.periodEnd !== undefined) meta.periodEnd = runtime.periodEnd;
  if (runtime.lastUpdated !== undefined) meta.lastUpdated = runtime.lastUpdated;

  return meta;
}
