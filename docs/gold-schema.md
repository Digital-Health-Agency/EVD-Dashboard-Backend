# EVD Gold Analytics Contract

This document defines the warehouse contract used by
`GET /api/analytics/metrics`. It reflects the database restored from
`db/evd_raw_2026-07-21.sql` and the lineage described in
`dashboard/docs/NDL_EVD_Bronze_Silver_Marts_Gold_Mapping.xlsx.pdf`.

The server queries the `gold` schema only. Bronze, Silver, and Marts remain ETL
implementation layers and are not API contracts.

## Architecture and business pathways

The restored warehouse follows the Medallion flow:

1. Bronze preserves raw source records.
2. Silver standardizes and deduplicates integration records.
3. Marts contains business-event facts and conformed dimensions.
4. Gold exposes dashboard-ready, row-level reporting models and additive
   measures.

The Gold reports represent separate surveillance pathways. They must not be
treated as one denormalized event table:

| Pathway | Gold report | Grain | Business meaning |
|---|---|---|---|
| Case investigation | `gold.report_case_investigation` | One case investigation | A case investigation form completed through the current case pathway |
| Contact tracing | `gold.report_contact_registration` | One registered contact | Contact registration/listing; it does not contain daily follow-up completion |
| Laboratory | `gold.report_lab_result` | One laboratory test/result | A test performed by a laboratory; requesting facility and testing laboratory are separate concepts |
| Traveller screening | `gold.report_screening` | One screening event | A normal or flagged traveller screening at a point of entry |
| Treatment outcome | `gold.report_treatment_outcome` | One case outcome record | Outcome after treatment; recovery and death are not laboratory-stage events |

The treatment outcome feed is currently interim and derived from ADAM. It must
be replaced by the ETU clinical outcome source when that feed becomes
available.

## Gold reports used by the API

### `gold.report_case_investigation`

Important dimensions and identifiers:

- `case_investigation_key`, `source_system`, `source_record_id`
- `investigation_date`, `investigation_datetime`, `reporting_date`
- `disease`, `reporting_county`, `reporting_subcounty`, `health_facility`
- `initial_classification`, `final_classification`,
  `reporting_case_classification`, `investigation_status`
- `sample_collected_flag`, `specimen_identifier`,
  `source_final_laboratory_result`
- `reporting_epi_year`, `reporting_epi_week`,
  `reporting_epi_week_label`

Additive measures used by the server:

- `total_investigation_count`
- `final_suspected_count`, `final_probable_count`,
  `final_confirmed_count`, `final_discarded_count`, `final_unknown_count`
- `sample_collected_count`, `sample_not_collected_count`

The API keeps the existing `totalCases` response key for compatibility, but its
precise warehouse meaning is the sum of `total_investigation_count`.
Classification totals use the final, not initial, classification measures.

### `gold.report_contact_registration`

Important dimensions:

- `contact_registration_key`, `source_system`, `source_record_id`
- `registration_date`, `registration_datetime`
- `disease`, `reporting_county`, `reporting_subcounty`, `health_facility`
- `initial_classification`, `final_classification`
- `reporting_epi_year`, `reporting_epi_week`,
  `reporting_epi_week_label`

Additive measures include `total_contact_registration_count`, classification
counts, `sampled_contact_count`, and data-completeness counts. The API maps
`contactsListed` to `sum(total_contact_registration_count)`.

This report does not contain daily contact follow-up activity, so
`contactsFollowedUp` remains unavailable.

### `gold.report_lab_result`

Important dimensions and dates:

- `lab_result_key`, `source_system`, `source_record_id`
- `subject_identifier`, `case_identifier`, `specimen_identifier`
- `collection_date`, `result_datetime`
- `reporting_collection_date`, `reporting_result_date`
- collection and result epi-week fields
- `requesting_facility_mfl`
- `testing_laboratory_code`, `testing_laboratory_name`
- `test_code`, `test_name`, `specimen_type`
- `result_category`, `turnaround_time_hours`, `turnaround_time_band`

Additive measures used by the server:

- `total_test_count`
- `positive_test_count`, `negative_test_count`,
  `inconclusive_test_count`, `other_result_count`, `unknown_result_count`
- `result_available_count`, `result_not_available_count`

`patientsTested` is the distinct count of the best available subject/case
identifier. `avgTatDays` is the average `turnaround_time_hours` divided by 24.
Positivity uses positive tests divided by positive + negative + inconclusive
tests; other and unknown results are excluded from that denominator.

All API laboratory totals, trends, date ranges, 24-hour values, positivity,
patient counts, and turnaround-time analysis are restricted to the canonical
EVD laboratory test code `86518-8`. Tests for Marburg (`86574-1`), Mpox
(`106615-8`), and any other non-EVD code are excluded.

### `gold.report_screening`

Important dimensions and dates:

- `screening_key`, `source_system`, `surveillance_pathway`
- `screening_date`, `screening_datetime`, `reporting_date`
- `point_of_entry`, `reporting_point_of_entry`
- `screening_outcome`, `reporting_screening_category`
- `reporting_epi_year`, `reporting_epi_week`,
  `reporting_epi_week_label`

Additive measures used by the server:

- `total_screening_count`
- `normal_screening_count`, `flagged_screening_count`
- `suspected_screening_count`, `probable_screening_count`,
  `unknown_screening_count`

`alerts` maps to `flagged_screening_count`. `suspected` is the sum of suspected
and probable screening counts. These values are kept separate because a
probable screening can also be flagged; adding all three would double-count an
event.

The report does not contain a confirmed/tested screening measure or a conformed
county. The API therefore does not infer these values from case or laboratory
records. Cross-system traveller deduplication is also pending, so
`uniqueTravelers` remains unavailable.

### `gold.report_treatment_outcome`

Important dimensions and dates:

- `treatment_outcome_key`, `source_system`, `source_record_id`
- `reporting_date`, `outcome_date`, `outcome_recorded_datetime`
- `treatment_outcome`, `outcome_validation_status`
- `final_classification`, `final_laboratory_result`
- `reporting_county`, `reporting_subcounty`, `health_facility`
- `reporting_epi_year`, `reporting_epi_week`,
  `reporting_epi_week_label`

Additive measures used by the server:

- `total_treatment_outcome_count`
- `alive_count`, `recovered_count`, `deceased_count`, `on_treatment_count`
- `transferred_count`, `lost_to_follow_up_count`, `unknown_outcome_count`
- validation and classification-specific outcome counts

The API sources `recoveries`, `deaths`, and their 24-hour deltas only from this
report. It does not treat a laboratory result or an unvalidated source death
date as a treatment outcome.

## API calculation rules

| API area | Gold source and calculation |
|---|---|
| `meta.lastUpdated` | Greatest available event timestamp across all five reports; the laboratory contribution is EVD-only |
| `cases` | Investigation totals/final classification from `report_case_investigation`; contacts from `report_contact_registration`; recovery/death from `report_treatment_outcome` |
| `cases.trend` | Gold epi-week investigation totals combined with weekly validated treatment deaths; rows without a valid reporting epi-week are excluded from the dated trend |
| `labs` | EVD-only test/result measures, distinct subjects, pending results, and average TAT from `report_lab_result` |
| `labs.trend` | EVD-only weekly result period, falling back to collection period |
| `poe` | Screening and flagged counts from `report_screening`, grouped by point of entry |
| `geography` | County totals from case investigations and treatment outcomes only |

The `new*24h` fields are rolling 24-hour windows anchored to the newest event
timestamp in the relevant Gold report, not to the server clock. The interval is
open at the start and closed at the end: `event_at > max_event_at - 24 hours`
and `event_at <= max_event_at`. This keeps historical snapshots meaningful and
avoids counting both endpoints when source timestamps are daily at midnight.

## Known unavailable or partial indicators

- Admissions/readiness indicators are not present in the current Gold reports.
- Contact registration exists, but daily follow-up completion does not.
- Community surveillance reports are planned, not implemented.
- Screening does not contain confirmed/tested counts or a conformed county.
- Laboratory Gold does not include county; it identifies requesting facility
  and testing laboratory instead.
- Geography therefore covers case investigations and treatment outcomes only.
- Treatment outcome is an interim ADAM-derived feed pending ETU clinical data.
- Person-level source fields, batch IDs, and source filenames are lineage data
  and must not be exposed by the public analytics API.

## Verification queries

List the active Gold contract:

```sql
select table_name
from information_schema.tables
where table_schema = 'gold'
order by table_name;
```

Check row counts and date coverage:

```sql
select count(*), min(reporting_date), max(reporting_date)
from gold.report_case_investigation;

select count(*), min(reporting_result_date), max(reporting_result_date)
from gold.report_lab_result
where test_code = '86518-8';

select count(*), min(reporting_date), max(reporting_date)
from gold.report_screening;
```

When the ETL changes, reconcile this document and
`src/modules/analytics/analytics.service.ts` against both the restored schema
and the mapping workbook before deployment.
