# EVD Analytics Guide for API Consumers

This guide describes the analytics data model exposed to API consumers,
following the Medallion architecture (Bronze -> Silver -> Marts -> Gold). It
reflects the current state of the repo. See `etl/docs/architecture.md` for the
underlying ETL design.

## 1. Architecture Overview

- **Bronze**: raw ingestion from source systems, no business transformations.
- **Silver**: cleaned, standardized, deduplicated datasets with harmonized
  fields.
- **Marts**: dimensional warehouse with conformed dimensions and fact tables.
- **Gold**: business-ready reporting models, optimized for dashboards and APIs.

## 2. Bronze Layer

Purpose: preserve source fidelity. Consumers: data engineers only.

Eight sending systems land in bronze today:

| Table | Sending system |
|---|---|
| `bronze.adam_cases_raw` | ADAM (cases) |
| `bronze.adam_travellers_raw` | ADAM (travellers) |
| `bronze.uhai_raw` | UHAI (traveler/case screenings) |
| `bronze.lims_raw` | LIMS (lab results) |
| `bronze.cbs_raw` | CBS (reports) |
| `bronze.mdharura_raw` | mDharura (signals) |
| `bronze.echis_raw` | eCHIS (signals) |
| `bronze.krcs_evd_screening_raw` | KRCS EVD screening |

## 3. Silver Layer

Purpose: cleansed operational datasets. Only 4 of the 8 bronze sources have a
silver model today. `cbs`, `mdharura`, `echis`, and `krcs_evd_screening` are
ingested into bronze but have no silver transform yet.

| Model | Source |
|---|---|
| `slv_adam_cases` | `bronze.adam_cases_raw` |
| `slv_adam_travellers` | `bronze.adam_travellers_raw` |
| `slv_uhai_cases` | `bronze.uhai_raw` |
| `slv_lims_results` | `bronze.lims_raw` |

Business rules applied: standardized dates, normalized Yes/No values, trimmed
text, data type enforcement, duplicate removal.

`silver_lims__raw.sql` also exists as a passthrough `select *` over
`bronze.lims_raw`. It is a legacy placeholder from before `slv_lims_results`
was written, not a second source of truth.

## 4. Marts Layer

Dimensions:

- `dim_date`: calendar dimension (2020-2035), `date_key` surrogate key.
- `dim_epiweek`: epi-week dimension derived from `dim_date`.
- `dim_location`: deduped county/subcounty/ward/point-of-entry combinations
  across ADAM and UHAI, `location_key` surrogate key.
- `dim_facilitylist`: facility master list from the MFL seed, `facility_key`
  surrogate key, `mfl_code`/`facility_name` for joins.
- `dim_labtest`: deduped lab test/specimen/LOINC combinations from
  `slv_lims_results`.

Facts:

- `fct_cases`: unions `slv_adam_cases` and `slv_uhai_cases`, deduped by
  `source_system`/`source_record_id`, joined to date/location/facility
  dimensions. Carries `case_count` plus suspected/probable/confirmed/tested/
  died/recovered flags and counts.
- `fct_screening`: unions ADAM traveller and UHAI screening records with the
  same dimension joins and count pattern.
- `fct_lab_result`: deduped LIMS results joined to facility and
  collection/result date dimensions, with categorized result
  (Positive/Negative/Inconclusive/Unknown/Other).
- `fct_contact` (future): known limitation. The file currently duplicates
  `fct_cases` union/dedup logic rather than implementing real contact-tracing
  joins. Not yet reliable for contact-tracing analytics.

Dimensions are for filtering and drill-downs; facts provide measures.

## 5. Gold Reporting Layer

Six report models exist today. Not yet built, and not safe to rely on as API
contracts: `report_case_demographics`, `report_case_outcomes`,
`report_contact_summary`.

### `report_case_summary`

Row-level case detail. One row per case from `fct_cases`, with
location/facility/date surrogate keys resolved to display names. No
aggregation, no rate metrics. Use `report_case_trend` or
`report_case_distribution` for weekly rollups.

| Column | Description |
|---|---|
| `case_key` | Surrogate key for the case (hash of `source_system` + `source_record_id`) |
| `source_system`, `source_record_id` | Originating system and its record identifier (dedup key) |
| `system_id`, `identifier_number`, `specimen_id` | Case/patient/specimen identifiers as reported by the source |
| `case_date_key`, `case_date` | Case date: surrogate key and resolved date |
| `created_date_key`, `created_date`, `created_at` | Record creation date: surrogate key, resolved date, raw timestamp |
| `location_key`, `county`, `subcounty`, `ward`, `point_of_entry` | Location surrogate key and resolved attributes |
| `facility_key`, `mfl_code`, `facility_name` | Facility surrogate key and resolved attributes |
| `record_type`, `case_classification`, `laboratory_result`, `outcome`, `samples_collected` | Case detail fields as reported |
| `suspected_flag`, `probable_flag`, `confirmed_flag`, `tested_flag`, `died_flag`, `recovered_flag` | Boolean indicators derived from classification/outcome |
| `case_count` | Always `1`; row-level counter, sum to get totals |
| `suspected_case_count`, `probable_case_count`, `confirmed_case_count`, `tested_case_count`, `sample_collected_count`, `recovered_case_count`, `death_count` | `1`/`0` counters mirroring the boolean flags, for summing |
| `batch_id`, `source_file` | Ingestion lineage: internal use only, never expose via public APIs |

### `report_case_trend`

Weekly case totals by geography/facility/source/record type, plus cumulative
and trend analytics (moving average, week-over-week change).

| Column | Description |
|---|---|
| `epi_week_key`, `epi_year`, `epi_week`, `epi_week_label`, `start_of_week`, `end_of_week` | Epi-week identifiers and calendar bounds |
| `county`, `subcounty`, `ward`, `point_of_entry` | Location grouping |
| `mfl_code`, `facility_name` | Facility grouping |
| `source_system`, `record_type` | Source and record-type grouping |
| `total_cases`, `suspected_cases`, `probable_cases`, `confirmed_cases`, `tested_cases`, `samples_collected`, `recovered_cases`, `deaths` | Weekly totals per case category |
| `cumulative_cases`, `cumulative_confirmed_cases`, `cumulative_deaths` | Year-to-date running totals within the `epi_year`, partitioned by county/subcounty/`mfl_code`/`source_system`/`record_type` |
| `moving_average_4_week_cases` | Trailing 4-week average of `total_cases` in the same partition |
| `previous_week_cases` | `total_cases` from the prior epi-week in the same partition |
| `weekly_case_change` | `total_cases` minus `previous_week_cases` |
| `weekly_case_change_percentage` | Week-over-week percent change |
| `confirmation_rate` | `confirmed_cases` as percent of `total_cases` |
| `testing_rate` | `tested_cases` as percent of `total_cases` |
| `sample_collection_rate` | `samples_collected` as percent of `total_cases` |
| `recovery_rate` | `recovered_cases` as percent of `confirmed_cases` |
| `case_fatality_rate` | `deaths` as percent of `confirmed_cases` |

### `report_case_distribution`

Weekly case totals by the same grouping as `report_case_trend`, with rate
metrics but without cumulative/trend columns.

| Column | Description |
|---|---|
| `epi_week_key`, `epi_year`, `epi_week`, `epi_week_label`, `start_of_week`, `end_of_week` | Epi-week identifiers and calendar bounds |
| `county`, `subcounty`, `ward`, `point_of_entry` | Location grouping |
| `mfl_code`, `facility_name` | Facility grouping |
| `source_system`, `record_type` | Source and record-type grouping |
| `total_cases`, `suspected_cases`, `probable_cases`, `confirmed_cases`, `tested_cases`, `samples_collected`, `recovered_cases`, `deaths` | Weekly totals per case category |
| `suspected_case_rate` | `suspected_cases` as percent of `total_cases` |
| `probable_case_rate` | `probable_cases` as percent of `total_cases` |
| `confirmation_rate` | `confirmed_cases` as percent of `total_cases` |
| `testing_rate` | `tested_cases` as percent of `total_cases` |
| `sample_collection_rate` | `samples_collected` as percent of `total_cases` |
| `recovery_rate` | `recovered_cases` as percent of `confirmed_cases` |
| `case_fatality_rate` | `deaths` as percent of `confirmed_cases` |

### `report_screening_summary`

Daily screening activity, enriched with the containing epi-week, by
geography/facility/source/classification.

| Column | Description |
|---|---|
| `screening_date` | Calendar date of the screening |
| `screening_year`, `screening_month_number`, `screening_month_name` | Date parts derived from `screening_date` |
| `epi_week_key`, `epi_year`, `epi_week`, `epi_week_label`, `start_of_week`, `end_of_week` | Epi-week `screening_date` falls in |
| `county`, `subcounty`, `ward`, `point_of_entry` | Location grouping |
| `mfl_code`, `facility_name` | Facility grouping |
| `source_system` | Sending system: ADAM travellers, UHAI |
| `classification`, `test_result` | Screening classification and test result as reported |
| `total_screening_records` | Count of screening records in the group |
| `total_screened` | Count actually screened |
| `total_suspected` | Count flagged suspected |
| `total_confirmed` | Count confirmed |
| `total_tested` | Count tested |
| `screening_completion_rate` | `total_screened` as percent of `total_screening_records` |
| `suspected_screening_rate` | `total_suspected` as percent of `total_screened` |
| `testing_rate` | `total_tested` as percent of `total_suspected` |
| `positivity_rate` | `total_confirmed` as percent of `total_tested` |
| `confirmed_screening_rate` | `total_confirmed` as percent of `total_screened` |

### `report_laboratory_summary`

Weekly and monthly lab result totals by facility/test attributes.

| Column | Description |
|---|---|
| `epi_week_key`, `epi_year`, `epi_week`, `epi_week_label`, `start_of_week`, `end_of_week` | Epi-week from result date, falling back to collection date |
| `result_year`, `result_month_number`, `result_month_name` | Date parts derived from result date |
| `county`, `subcounty` | Facility location from `dim_facilitylist` |
| `mfl_code`, `facility_name` | Facility grouping |
| `source_system` | Sending system: LIMS |
| `specimen_type` | Type of specimen tested |
| `loinc_code`, `test_name`, `code_text`, `component_code` | Test naming/coding attributes |
| `unit` | Result unit of measure |
| `result_category` | Categorized result: Positive/Negative/Inconclusive/Unknown/Other |
| `total_tests` | Count of tests in the group |
| `positive_tests`, `negative_tests`, `inconclusive_tests`, `unknown_tests`, `other_tests` | Counts by result category |
| `positivity_rate` | `positive_tests` as percent of positive + negative + inconclusive tests |
| `negative_rate` | `negative_tests` as percent of `total_tests` |
| `inconclusive_rate` | `inconclusive_tests` as percent of `total_tests` |
| `unknown_result_rate` | `unknown_tests` as percent of `total_tests` |
| `result_completion_rate` | Positive + negative + inconclusive tests as percent of `total_tests` |

### `report_geographic_summary`

Daily activity combining cases, screening, and lab results into one
geography/facility-oriented table. Each domain is unioned in, not joined.

| Column | Description |
|---|---|
| `activity_date` | Calendar date of the activity: case, screening, or lab |
| `activity_year`, `activity_month_number`, `activity_month_name` | Date parts derived from `activity_date` |
| `epi_week_key`, `epi_year`, `epi_week`, `epi_week_label`, `start_of_week`, `end_of_week` | Epi-week `activity_date` falls in |
| `county`, `subcounty`, `ward`, `point_of_entry` | Location grouping; `ward`/`point_of_entry` are null on lab-only rows |
| `mfl_code`, `facility_name` | Facility grouping |
| `total_cases`, `confirmed_cases`, `tested_cases`, `deaths` | Case-domain totals; `0` on screening/lab-only rows |
| `total_screening_records`, `total_screened`, `suspected_screenings`, `confirmed_screenings`, `tested_screenings` | Screening-domain totals; `0` on case/lab-only rows |
| `laboratory_tests`, `positive_tests`, `negative_tests`, `inconclusive_tests` | Lab-domain totals; `0` on case/screening-only rows |
| `confirmation_rate` | `confirmed_cases` as percent of `total_cases` |
| `case_testing_rate` | `tested_cases` as percent of `total_cases` |
| `case_fatality_rate` | `deaths` as percent of `confirmed_cases` |
| `suspected_screening_rate` | `suspected_screenings` as percent of `total_screened` |
| `screening_testing_rate` | `tested_screenings` as percent of `suspected_screenings` |
| `screening_positivity_rate` | `confirmed_screenings` as percent of `tested_screenings` |
| `laboratory_positivity_rate` | `positive_tests` as percent of positive + negative + inconclusive tests |

Note: cases, screening, and lab activity are combined with `UNION ALL` by
date/geography/facility, not joined. A given row typically has non-zero values
in only one domain's columns. Aggregate across rows, for example
`sum(...) group by county, epi_week`, to get a true cross-domain total for a
geography/week.

## 6. API Consumption Guidelines

- Use Gold models for reporting.
- Use Marts facts only for advanced analytics.
- Avoid querying Bronze directly.
- Filter using date, epidemiological week, county, subcounty, facility, and
  `source_system` where available.

## 7. Common Dimensions

- **Time**: `full_date` (`dim_date`), epi_year/epi_week (`dim_epiweek`).
- **Geography**: county, subcounty, ward, point_of_entry (`dim_location`,
  `location_key`).
- **Facility**: `facility_key`, `mfl_code`, `facility_name`
  (`dim_facilitylist`).
- **Source**: `source_system` values are `adam`, `uhai`, `lims`, `cbs`,
  `mdharura`, `echis`, `krcs_evd_screening`. Only `adam`, `uhai`, and `lims`
  currently flow through to marts/gold.

## 8. Typical Analytics

Executive KPIs, weekly case trends, screening performance, laboratory
positivity, facility performance, geographic summaries, and operational
monitoring.

## 9. Best Practices

- Always query Gold for dashboards.
- Join on surrogate keys: `case_key`, `location_key`, `facility_key`,
  `date_key`.
- Use `dim_epiweek` for weekly reporting.
- Do not expose internal batch IDs (`batch_id`, `source_file`) through public
  APIs.
- Version API responses as models evolve.

## 10. Transform Guide (Engineering)

This section is for engineers extending the dbt build under
`transform/evd_transform/`, not just consuming its output.

### Project Layout

```text
transform/evd_transform/
|-- models/
|   |-- silver/                  # schema: silver
|   |   `-- _sources.yml         # declares bronze.* as dbt sources
|   |-- marts/                   # schema: marts
|   |   |-- dimensions/
|   |   `-- facts/
|   `-- gold/                    # schema: gold
`-- dbt_project.yml              # +materialized: table per layer
```

`transform/profiles.yml` lives in-repo and is environment-variable driven, not
`~/.dbt/`.

### Enforced Ref Chain

- `silver` models use `{{ source('bronze', '<table>') }}`, never a raw table
  name.
- `marts` models use `{{ ref(...) }}` only on `silver` models.
- `gold` models use `{{ ref(...) }}` only on `marts` models (dimensions or
  facts), never on `silver` or `bronze` directly.

This is enforced by convention, not a dbt constraint. Verify with
`grep ref(` over `models/gold/`: every gold model's `ref()` calls should
resolve to `fct_*`/`dim_*` marts models, none to a `slv_*` silver model.

### Adding a New Bronze Source Through to Gold

1. Bronze wiring: see `CLAUDE.md` "Adding a new sending system" steps:
   `build_bronze_asset`, `Definitions(assets=[...])` registration, and dbt
   source in `_sources.yml`.
2. One silver model per meaningful entity, for example
   `silver_<source>__<entity>.sql`, typing/casting/deduping the bronze `TEXT`
   columns. Use `make explore SOURCE=<name>` first to see the inferred bronze
   shape before writing the cast list.
3. Wire the new silver model into the relevant marts fact (union + dedupe
   pattern, see `fct_cases.sql`) and/or dimension.
4. Add or extend a gold report model if a new business view is needed.

### Key Commands

- `dbt run`, `dbt run --select silver`, `dbt run --select marts+`: build a
  layer and everything downstream.
- `dbt test`: run schema tests declared in model `.yml` files.
- `make explore SOURCE=<name>`: dry-run; samples MinIO and prints the inferred
  bronze schema without writing anything.
- In production, `dbt run` is not invoked manually. The Dagster
  `evd_dbt_assets` under `assets/transform/` wraps the dbt project and runs it
  as part of the orchestrated pipeline.

### Known Gaps for Maintainers

- `silver_lims__raw.sql` is a legacy `select *` placeholder superseded by
  `slv_lims_results.sql`; candidate for removal.
- Schema/data tests are sparse. Only `silver_lims__raw.yml` has any
  (`unique`/`not_null` on `_raw_hash`). Most silver/marts/gold models have no
  `.yml` tests yet.
- `cbs`, `mdharura`, `echis`, `krcs_evd_screening` have bronze tables and
  declared dbt sources but no silver model. Silver models are the first step
  for onboarding them into marts/gold.
- `fct_contact.sql` needs real contact-tracing source data and join logic. It
  currently copies `fct_cases.sql`.
