import { Inject, Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';

import {
  ANALYTICS_POSTGRES_POOL,
  type Queryable,
} from '../../database/database.module.js';
import {
  PERIOD_INTERVALS,
  num,
  nullableNum,
  pending,
  source,
  stringValue,
  type Provenance,
} from '../../common/analytics-helpers.js';
import {
  catalogEntry,
  catalogSources,
  withRuntimeMeta,
} from './indicator-catalog.js';
import type {
  IndicatorMeta,
  TabBreakdown,
  TabCard,
  TabCardBreakdownEntry,
  TabChart,
  TabPayload,
  TabWindow,
} from './tab-payload.js';
import type { OperationalFiltersDto } from './dto/operational-filters.dto.js';

interface NumberRow extends QueryResultRow {
  [key: string]: unknown;
}

const EVD_LAB_TEST_CODE = '86518-8';

const LAB_SOURCE_LABEL = 'Source: gold.report_lab_result';

const LAB_FILTER_COLUMNS: ReadonlyArray<
  readonly [keyof OperationalFiltersDto, string]
> = Object.freeze([
  ['resultStatus', 'result_category'],
  ['specimenType', 'specimen_type'],
  ['testName', 'test_name'],
  ['turnaroundBand', 'turnaround_time_band'],
] as const);

const LAB_RESULT_BUCKETS: ReadonlyArray<{
  name: string;
  key: 'positive' | 'negative';
  color: string;
}> = Object.freeze([
  { name: 'Negative', key: 'negative', color: '#1f7a4d' },
  { name: 'Positive', key: 'positive', color: '#b42318' },
]);

const POE_SURVEILLANCE_PATHWAY = 'TRAVELLER';

const POE_SOURCE_LABEL = 'Source: gold.report_screening';

const POE_FILTER_COLUMNS: ReadonlyArray<
  readonly [keyof OperationalFiltersDto, string]
> = Object.freeze([
  ['screeningOutcome', 'screening_outcome'],
  ['screeningCategory', 'reporting_screening_category'],
] as const);

const POE_GROUP_EXPRESSION = `coalesce(nullif(reporting_point_of_entry, ''), nullif(point_of_entry, ''), 'Not recorded')`;

const HF_CASE_SOURCE_LABEL = 'Source: gold.report_case_investigation';
const HF_OUTCOME_SOURCE_LABEL = 'Source: gold.report_treatment_outcome';
const HF_SOURCE_LABEL =
  'Source: gold.report_case_investigation / gold.report_treatment_outcome';
const HF_SCREENING_SOURCE_SYSTEM = 'TAIFACARE_KENYAEMR';
const HF_SCREENING_SOURCE_LABEL =
  'Source: gold.report_screening (TAIFACARE_KENYAEMR)';
const HF_FACILITY_EXPRESSION = `coalesce(
  nullif(btrim(reporting_facility_name), ''),
  nullif(btrim(facility_name), ''),
  'Not recorded'
)`;

const CONTACT_SOURCE_LABEL = 'Source: gold.report_contact_registration';

const CONTACT_GROUP_EXPRESSION = `coalesce(nullif(btrim(reporting_county), ''), 'Not recorded')`;

const COMMUNITY_SOURCE_LABEL = 'Source: gold.report_community_signals';

const COMMUNITY_FILTER_COLUMNS: ReadonlyArray<
  readonly [keyof OperationalFiltersDto, string]
> = Object.freeze([['communitySource', 'source_system']] as const);

const COMMUNITY_GROUP_EXPRESSION = `coalesce(nullif(btrim(county), ''), 'Not recorded')`;

const BREAKDOWN_LIMIT = 50;

const NEGATIVE_TESTS_EXPR =
  '(coalesce(sum(total_test_count), 0) - coalesce(sum(positive_test_count), 0))::int';

const CHART_LIMIT = 10;

const SUMMARY_FLOW_SOURCE_LABEL =
  'Source: gold.report_community_signals / gold.report_lab_result';

const SUMMARY_MAX_CONCURRENT_QUERIES = 3;

const WINDOW_AND_FRESHNESS_COLUMNS = `to_char(min(event_at), 'YYYY-MM-DD') AS window_from,
        to_char(max(event_at), 'YYYY-MM-DD') AS window_to,
        (
          SELECT to_char(max_ingested_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
          FROM bounds
        ) AS last_updated`;

interface SectionBounds {
  windowFrom: string | null;
  windowTo: string | null;
  lastUpdated: string | null;
}

function sectionBounds(row: NumberRow): SectionBounds {
  return {
    windowFrom: stringValue(row.window_from),
    windowTo: stringValue(row.window_to),
    lastUpdated: stringValue(row.last_updated),
  };
}

type Tasks = readonly (() => Promise<unknown>)[];

type AwaitedResults<T extends Tasks> = {
  -readonly [K in keyof T]: Awaited<ReturnType<T[K]>>;
};

export async function inBoundedGroups<T extends Tasks>(
  tasks: T,
  size: number,
): Promise<AwaitedResults<T>> {
  const results: unknown[] = [];
  for (let index = 0; index < tasks.length; index += size) {
    const group = tasks.slice(index, index + size) as Tasks;
    results.push(...(await Promise.all(group.map((task) => task()))));
  }
  return results as AwaitedResults<T>;
}

export interface CardInput {
  key: string;
  label: string;
  tone: TabCard['tone'];
  value: number | null;
  unit?: TabCard['unit'];
  detail?: string | null;
  emphasis?: TabCard['emphasis'];
  breakdown?: TabCardBreakdownEntry[];
  provenance: Provenance;
  meta?: IndicatorMeta;
}

export function suppressed(
  provenance: Provenance,
  meta?: IndicatorMeta,
): boolean {
  const quality = meta?.dataQualityStatus;
  return provenance.source === 'pending' || quality === 'unavailable';
}

export function buildChart(input: TabChart): TabChart {
  if (!suppressed(input.provenance, input.meta)) return input;
  return { ...input, data: [] };
}

export function buildBreakdown(input: TabBreakdown): TabBreakdown {
  if (!suppressed(input.provenance, input.meta)) return input;

  const numericKeys = input.columns
    .filter((column) => column.align === 'num')
    .map((column) => column.key);

  return {
    ...input,
    rows: input.rows.map((row) => {
      const next = { ...row };
      for (const key of numericKeys) next[key] = null;
      return next;
    }),
  };
}

export function buildCard(input: CardInput): TabCard {
  const isSuppressed = suppressed(input.provenance, input.meta);

  const breakdown = input.breakdown?.map((entry) => ({
    ...entry,
    value: isSuppressed ? null : entry.value,
  }));

  return {
    key: input.key,
    label: input.label,
    emphasis: input.emphasis ?? 'plain',
    tone: input.tone,
    value: isSuppressed ? null : input.value,
    unit: isSuppressed ? null : (input.unit ?? 'count'),
    detail: isSuppressed ? null : (input.detail ?? null),
    ...(breakdown ? { breakdown } : {}),
    provenance: input.provenance,
    ...(input.meta ? { meta: input.meta } : {}),
  };
}

export function earliest(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a <= b ? a : b;
}

export function latest(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a >= b ? a : b;
}

interface ScopedQuery {
  sql: string;
  params: unknown[];
  anchored: boolean;
}

@Injectable()
export class OperationalService {
  constructor(
    @Inject(ANALYTICS_POSTGRES_POOL) private readonly analyticsDb: Queryable,
  ) {}

  async labsTab(filters: OperationalFiltersDto): Promise<TabPayload> {
    const [summary, breakdownRows] = await Promise.all([
      this.labSummary(filters),
      this.labBreakdown(filters),
    ]);

    const window: TabWindow = {
      period: filters.period,
      from: summary.windowFrom,
      to: summary.windowTo,
      anchored: summary.anchored,
    };

    const runtime = {
      periodStart: window.from,
      periodEnd: window.to,
      lastUpdated: summary.lastUpdated,
    };

    const provenance = source(LAB_SOURCE_LABEL);

    const cards: TabCard[] = [
      buildCard({
        key: 'testsDone',
        label: 'Tests done',
        tone: 'blue',
        value: summary.testsDone,
        detail: 'Laboratory test events in the selected period',
        provenance,
        meta: withRuntimeMeta(catalogEntry('labs.testsDone'), runtime),
      }),
      buildCard({
        key: 'positiveTests',
        label: 'Positive tests',
        tone: 'red',
        value: summary.positiveTests,
        detail: 'Test events with a positive result',
        provenance,
        meta: withRuntimeMeta(catalogEntry('labs.positiveTests'), runtime),
      }),
      buildCard({
        key: 'negativeTests',
        label: 'Negative tests',
        tone: 'green',
        value: summary.negativeTests,
        detail: 'All test events not recorded positive',
        provenance,
        meta: withRuntimeMeta(catalogEntry('labs.negativeTests'), runtime),
      }),
    ];

    const byLaboratoryLinelist = {
      dataset: 'labResults',
      filterKey: 'lab',
      listLabel: 'Tests',
      noun: 'lab results',
    };

    const chart: TabChart = buildChart({
      key: 'byLaboratory',
      title: 'Tests by testing laboratory',
      subtitle: null,
      kind: 'bar',
      orientation: 'vertical',
      height: 280,
      categoryKey: 'name',
      series: [
        { key: 'positive', label: 'Positive', color: '#b42318' },
        { key: 'negative', label: 'Negative', color: '#1f7a4d' },
      ],
      data: breakdownRows.rows,
      linelist: byLaboratoryLinelist,
      provenance,
      meta: withRuntimeMeta(catalogEntry('labs.byLaboratory'), runtime),
    });

    const breakdown: TabBreakdown = buildBreakdown({
      title: 'Tests by testing laboratory',
      columns: [
        { key: 'name', label: 'Laboratory', align: 'text', pending: false },
        { key: 'tests', label: 'Tests', align: 'num', pending: false },
        { key: 'positive', label: 'Positive', align: 'num', pending: false },
        { key: 'negative', label: 'Negative', align: 'num', pending: false },
      ],
      rows: breakdownRows.rows,
      total: breakdownRows.total,
      shown: breakdownRows.rows.length,
      linelist: byLaboratoryLinelist,
      provenance,
      meta: withRuntimeMeta(catalogEntry('labs.byLaboratory'), runtime),
    });

    return {
      meta: {
        tab: 'labs',
        filters: {
          period: filters.period,
          from: filters.from ?? null,
          to: filters.to ?? null,
          lab: filters.lab ?? null,
          resultStatus: filters.resultStatus ?? null,
          specimenType: filters.specimenType ?? null,
          testName: filters.testName ?? null,
          turnaroundBand: filters.turnaroundBand ?? null,
        },
        window,
        sources: catalogSources([
          'labs.testsDone',
          'labs.positiveTests',
          'labs.negativeTests',
          'labs.byLaboratory',
        ]),
        provenance: {
          cards: provenance,
          chart: provenance,
          breakdown: provenance,
        },
      },
      cards,
      charts: [chart],
      breakdown,
    };
  }

  async poeTab(filters: OperationalFiltersDto): Promise<TabPayload> {
    const [summary, breakdownRows] = await Promise.all([
      this.poeSummary(filters),
      this.poeBreakdown(filters),
    ]);

    const window: TabWindow = {
      period: filters.period,
      from: summary.windowFrom,
      to: summary.windowTo,
      anchored: summary.anchored,
    };

    const runtime = {
      periodStart: window.from,
      periodEnd: window.to,
      lastUpdated: summary.lastUpdated,
    };

    const provenance = source(POE_SOURCE_LABEL);

    const cards: TabCard[] = [
      buildCard({
        key: 'travellersScreened',
        label: 'Travellers screened',
        tone: 'blue',
        value: summary.travellersScreened,
        detail: 'Traveller screenings recorded in the selected period',
        provenance,
        meta: withRuntimeMeta(catalogEntry('poe.travellersScreened'), runtime),
      }),
    ];

    const byPoeLinelist = {
      dataset: 'screenings',
      filterKey: 'poe',
      listLabel: 'Screenings',
      noun: 'screenings',
    };

    const chart: TabChart = buildChart({
      key: 'byPointOfEntry',
      title: 'Screenings by point of entry',
      subtitle: null,
      kind: 'bar',
      orientation: 'vertical',
      height: 300,
      categoryKey: 'name',
      series: [{ key: 'screened', label: 'Screenings', color: '#0369a1' }],
      data: breakdownRows.rows,
      linelist: byPoeLinelist,
      provenance,
      meta: withRuntimeMeta(catalogEntry('poe.byPointOfEntry'), runtime),
    });

    const breakdown: TabBreakdown = buildBreakdown({
      title: 'Screenings by point of entry',
      columns: [
        { key: 'name', label: 'Point of entry', align: 'text', pending: false },
        { key: 'screened', label: 'Screened', align: 'num', pending: false },
      ],
      rows: breakdownRows.rows,
      total: breakdownRows.total,
      shown: breakdownRows.rows.length,
      linelist: byPoeLinelist,
      provenance,
      meta: withRuntimeMeta(catalogEntry('poe.byPointOfEntry'), runtime),
    });

    return {
      meta: {
        tab: 'poe',
        filters: {
          period: filters.period,
          from: filters.from ?? null,
          to: filters.to ?? null,
          poe: filters.poe ?? null,
          screeningOutcome: filters.screeningOutcome ?? null,
          screeningCategory: filters.screeningCategory ?? null,
        },
        window,
        provenance: {
          cards: provenance,
          chart: provenance,
          breakdown: provenance,
        },
      },
      cards,
      charts: [chart],
      breakdown,
    };
  }

  async hfTab(filters: OperationalFiltersDto): Promise<TabPayload> {
    const [summary, breakdownRows] = await Promise.all([
      this.hfSummary(filters),
      this.hfBreakdown(filters),
    ]);

    const window: TabWindow = {
      period: filters.period,
      from: summary.windowFrom,
      to: summary.windowTo,
      anchored: summary.anchored,
    };
    const runtime = {
      periodStart: window.from,
      periodEnd: window.to,
      lastUpdated: summary.lastUpdated,
    };
    const provenance = source(HF_SCREENING_SOURCE_LABEL);

    const cards: TabCard[] = [
      buildCard({
        key: 'screened',
        label: 'Screened',
        tone: 'blue',
        value: summary.total,
        detail: 'Facility screenings recorded in the selected window',
        provenance,
        meta: withRuntimeMeta(catalogEntry('hf.screened'), runtime),
      }),
      buildCard({
        key: 'alerts',
        label: 'Alerts',
        tone: 'red',
        value: summary.alerts,
        detail: 'Facility screenings flagged for further action',
        provenance,
        meta: withRuntimeMeta(catalogEntry('hf.alerts'), runtime),
      }),
      buildCard({
        key: 'confirmed',
        label: 'Confirmed',
        tone: 'blue',
        value: 0,
        detail: 'Facility screenings confirmed as EVD cases',
        provenance,
        meta: withRuntimeMeta(catalogEntry('hf.confirmed'), runtime),
      }),
      buildCard({
        key: 'currentAdmitted',
        label: 'Current admitted',
        tone: 'blue',
        value: 0,
        detail: 'Screened patients currently admitted for care',
        provenance,
        meta: withRuntimeMeta(catalogEntry('hf.currentAdmitted'), runtime),
      }),
      buildCard({
        key: 'recovered',
        label: 'Recovered',
        tone: 'green',
        value: 0,
        detail: 'Admitted patients discharged after recovery',
        provenance,
        meta: withRuntimeMeta(catalogEntry('hf.recovered'), runtime),
      }),
      buildCard({
        key: 'deaths',
        label: 'Deaths',
        tone: 'amber',
        value: 0,
        detail: 'Deaths among patients admitted after screening',
        provenance,
        meta: withRuntimeMeta(catalogEntry('hf.deaths'), runtime),
      }),
    ];

    const chart: TabChart = buildChart({
      key: 'byFacility',
      title: 'Screenings, alerts and confirmed by facility',
      subtitle: null,
      kind: 'bar',
      orientation: 'vertical',
      height: 300,
      categoryKey: 'name',
      series: [
        // Screening volume keeps the same blue it carries on the PoE chart.
        { key: 'screened', label: 'Screened', color: '#0369a1' },
        { key: 'alerts', label: 'Alerts', color: '#b42318' },
        { key: 'confirmed', label: 'Confirmed', color: '#35459c' },
      ],
      data: breakdownRows.rows,
      provenance,
      meta: withRuntimeMeta(catalogEntry('hf.byFacility'), runtime),
    });

    const breakdown: TabBreakdown = buildBreakdown({
      title: 'Facility detail',
      columns: [
        { key: 'name', label: 'Facility', align: 'text', pending: false },
        { key: 'screened', label: 'Screened', align: 'num', pending: false },
        { key: 'alerts', label: 'Alerts', align: 'num', pending: false },
        { key: 'confirmed', label: 'Confirmed', align: 'num', pending: false },
        {
          key: 'currentAdmitted',
          label: 'Current admitted',
          align: 'num',
          pending: false,
        },
        { key: 'recovered', label: 'Recovered', align: 'num', pending: false },
        { key: 'deaths', label: 'Deaths', align: 'num', pending: false },
      ],
      rows: breakdownRows.rows,
      total: breakdownRows.total,
      shown: breakdownRows.rows.length,
      provenance,
      meta: withRuntimeMeta(catalogEntry('hf.byFacility'), runtime),
    });

    return {
      meta: {
        tab: 'hf',
        filters: {
          period: filters.period,
          from: filters.from ?? null,
          to: filters.to ?? null,
          facility: filters.facility ?? null,
        },
        window,
        provenance: {
          cards: provenance,
          chart: provenance,
          breakdown: provenance,
        },
      },
      cards,
      charts: [chart],
      breakdown,
    };
  }

  async contactsTab(filters: OperationalFiltersDto): Promise<TabPayload> {
    const [summary, groups] = await Promise.all([
      this.contactSummary(filters),
      this.contactsByCounty(filters),
    ]);

    const window: TabWindow = {
      period: filters.period,
      from: summary.windowFrom,
      to: summary.windowTo,
      anchored: summary.anchored,
    };

    const runtime = {
      periodStart: window.from,
      periodEnd: window.to,
      lastUpdated: summary.lastUpdated,
    };

    const provenance = source(CONTACT_SOURCE_LABEL);

    const cards: TabCard[] = [
      buildCard({
        key: 'contactsListed',
        label: 'Contacts listed',
        tone: 'blue',
        value: summary.contactsListed,
        detail: 'Contacts registered in the selected period',
        provenance,
        meta: withRuntimeMeta(catalogEntry('contacts.contactsListed'), runtime),
      }),
    ];

    const chart: TabChart = buildChart({
      key: 'byCounty',
      title: 'Contacts listed by county',
      subtitle: null,
      kind: 'bar',
      orientation: 'vertical',
      height: 300,
      categoryKey: 'name',
      series: [{ key: 'listed', label: 'Contacts listed', color: '#0369a1' }],
      data: groups.rows.slice(0, CHART_LIMIT).map((row) => ({
        name: row.name,
        listed: row.listed,
      })),
      provenance,
      meta: withRuntimeMeta(catalogEntry('contacts.byCounty'), runtime),
    });

    const breakdown: TabBreakdown = buildBreakdown({
      title: 'Contacts listed by county',
      columns: [
        { key: 'name', label: 'County', align: 'text', pending: false },
        { key: 'listed', label: 'Listed', align: 'num', pending: false },
      ],
      rows: groups.rows,
      total: groups.total,
      shown: groups.rows.length,
      provenance,
      meta: withRuntimeMeta(catalogEntry('contacts.byCounty'), runtime),
    });

    return {
      meta: {
        tab: 'contacts',
        filters: {
          period: filters.period,
          from: filters.from ?? null,
          to: filters.to ?? null,
          classification: filters.classification ?? null,
        },
        window,
        provenance: {
          cards: provenance,
          chart: provenance,
          breakdown: provenance,
        },
      },
      cards,
      charts: [chart],
      breakdown,
    };
  }

  async communityTab(filters: OperationalFiltersDto): Promise<TabPayload> {
    const [summary, groups] = await Promise.all([
      this.communitySummary(filters),
      this.communityByCounty(filters),
    ]);

    const window: TabWindow = {
      period: filters.period,
      from: summary.windowFrom,
      to: summary.windowTo,
      anchored: summary.anchored,
    };

    const runtime = {
      periodStart: window.from,
      periodEnd: window.to,
      lastUpdated: summary.lastUpdated,
    };

    const provenance = source(COMMUNITY_SOURCE_LABEL);
    const verifiedShareIsDefined = summary.verifiedShare !== null;

    const cards: TabCard[] = [
      buildCard({
        key: 'signalsReported',
        label: 'Signals reported',
        tone: 'blue',
        value: summary.signalsReported,
        detail: 'Community signals reported in the selected period',
        provenance,
        meta: withRuntimeMeta(catalogEntry('community.signalsReported'), runtime),
      }),
      buildCard({
        key: 'signalsVerified',
        label: 'Signals verified',
        tone: 'green',
        value: summary.signalsVerified,
        detail: verifiedShareIsDefined
          ? `${summary.verifiedShare}% of ${summary.signalsReported} reported`
          : summary.signalsReported > 0
            ? `of ${summary.signalsReported} signals reported`
            : 'No signal reported in the selected period',
        provenance,
        meta: withRuntimeMeta(catalogEntry('community.signalsVerified'), runtime),
      }),
    ];

    const chart: TabChart = buildChart({
      key: 'byCounty',
      title: 'Verified signals by county',
      subtitle: null,
      kind: 'bar',
      orientation: 'vertical',
      height: 300,
      categoryKey: 'name',
      series: [{ key: 'verified', label: 'Verified signals', color: '#1f7a4d' }],
      data: groups.rows.slice(0, CHART_LIMIT).map((row) => ({
        name: row.name,
        verified: row.verified,
      })),
      provenance,
      meta: withRuntimeMeta(catalogEntry('community.byCounty'), runtime),
    });

    const breakdown: TabBreakdown = buildBreakdown({
      title: 'Signals by county',
      columns: [
        { key: 'name', label: 'County', align: 'text', pending: false },
        { key: 'reported', label: 'Reported', align: 'num', pending: false },
        { key: 'verified', label: 'Verified', align: 'num', pending: false },
      ],
      rows: groups.rows,
      total: groups.total,
      shown: groups.rows.length,
      provenance,
      meta: withRuntimeMeta(catalogEntry('community.byCounty'), runtime),
    });

    return {
      meta: {
        tab: 'community',
        filters: {
          period: filters.period,
          from: filters.from ?? null,
          to: filters.to ?? null,
          communitySource: filters.communitySource ?? null,
        },
        window,
        provenance: {
          cards: provenance,
          chart: provenance,
          breakdown: provenance,
        },
      },
      cards,
      charts: [chart],
      breakdown,
    };
  }

  async summaryTab(filters: OperationalFiltersDto): Promise<TabPayload> {
    const [
      caseAgg,
      outcomeAgg,
      screeningAgg,
      communityAgg,
      labAgg,
      contactAgg,
      flowRows,
      facilityGroups,
    ] = await inBoundedGroups(
      [
        () => this.summaryCases(filters),
        () => this.summaryOutcomes(filters),
        () => this.summaryScreenings(filters),
        () => this.summaryCommunity(filters),
        () => this.summaryLaboratory(filters),
        () => this.summaryContacts(filters),
        () => this.summaryDailyFlow(filters),
        () => this.summaryFacilities(filters),
      ] as const,
      SUMMARY_MAX_CONCURRENT_QUERIES,
    );

    const sections: SectionBounds[] = [
      caseAgg,
      outcomeAgg,
      screeningAgg,
      communityAgg,
      labAgg,
      contactAgg,
    ];

    const window: TabWindow = {
      period: filters.period,
      from: sections.reduce<string | null>(
        (acc, section) => earliest(acc, section.windowFrom),
        null,
      ),
      to: sections.reduce<string | null>(
        (acc, section) => latest(acc, section.windowTo),
        null,
      ),
      anchored: caseAgg.anchored,
    };

    const runtime = {
      periodStart: window.from,
      periodEnd: window.to,
      lastUpdated: sections.reduce<string | null>(
        (acc, section) => earliest(acc, section.lastUpdated),
        null,
      ),
    };

    const caseProvenance = source(HF_CASE_SOURCE_LABEL);
    const outcomeProvenance = source(HF_OUTCOME_SOURCE_LABEL);
    const screeningProvenance = source(POE_SOURCE_LABEL);
    const communityProvenance = source(COMMUNITY_SOURCE_LABEL);
    const labProvenance = source(LAB_SOURCE_LABEL);
    const flowProvenance = source(SUMMARY_FLOW_SOURCE_LABEL);

    const followUpGap = pending(
      'Awaiting a contact follow-up measure in the warehouse',
    );
    const facilityProvenance = source(HF_SOURCE_LABEL);
    const noSignalsInScope = pending(
      'No signal in scope — verified share undefined',
    );
    const verifiedIsDefined = communityAgg.verifiedShare !== null;

    const cfr =
      caseAgg.confirmedCases > 0
        ? Math.round((outcomeAgg.deaths / caseAgg.confirmedCases) * 1000) / 10
        : null;

    const cards: TabCard[] = [
      buildCard({
        key: 'alerts',
        label: 'Alerts',
        tone: 'amber',
        emphasis: 'important',
        value: caseAgg.alerts,
        detail: 'Case investigations opened as suspected or probable',
        provenance: caseProvenance,
        meta: withRuntimeMeta(catalogEntry('summary.alerts'), runtime),
      }),
      buildCard({
        key: 'confirmedCases',
        label: 'Confirmed cases',
        tone: 'red',
        emphasis: 'important',
        value: caseAgg.confirmedCases,
        detail: 'Case investigations finally classified confirmed',
        provenance: caseProvenance,
        meta: withRuntimeMeta(catalogEntry('summary.confirmedCases'), runtime),
      }),
      buildCard({
        key: 'currentAdmitted',
        label: 'Current admitted',
        tone: 'blue',
        emphasis: 'important',
        value: 0,
        detail: 'Confirmed or probable cases currently admitted',
        provenance: outcomeProvenance,
        meta: withRuntimeMeta(catalogEntry('summary.currentAdmitted'), runtime),
      }),
      buildCard({
        key: 'recovered',
        label: 'Recoveries',
        tone: 'green',
        emphasis: 'important',
        value: outcomeAgg.recovered,
        detail: 'Treatment outcomes recorded as recovered',
        provenance: outcomeProvenance,
        meta: withRuntimeMeta(catalogEntry('summary.recovered'), runtime),
      }),
      buildCard({
        key: 'deaths',
        label: 'Deaths',
        tone: 'navy',
        emphasis: 'important',
        value: outcomeAgg.deaths,
        detail: null,
        breakdown: [
          {
            key: 'caseFatalityRate',
            label: 'Case fatality rate',
            value: cfr,
            unit: 'percent',
          },
        ],
        provenance: outcomeProvenance,
        meta: withRuntimeMeta(catalogEntry('summary.deaths'), runtime),
      }),
    ];

    const charts: TabChart[] = [
      buildChart({
        key: 'dailyFlow',
        title: 'Daily signal and sample flow',
        subtitle: null,
        kind: 'line',
        orientation: 'vertical',
        height: 320,
        categoryKey: 'day',
        series: [
          { key: 'signals', label: 'Signals', color: '#0369a1' },
          { key: 'verified', label: 'Verified signals', color: '#1f7a4d' },
          { key: 'samples', label: 'Samples', color: '#b7791f' },
        ],
        data: flowRows,
        provenance: flowProvenance,
        meta: withRuntimeMeta(catalogEntry('summary.dailyFlow'), runtime),
      }),
      buildChart({
        key: 'sampleStatus',
        title: 'Result status',
        subtitle: null,
        kind: 'bar',
        orientation: 'vertical',
        height: 280,
        categoryKey: 'name',
        series: [{ key: 'value', label: 'Tests', color: '#0369a1' }],
        data: labAgg.buckets,
        provenance: labProvenance,
        meta: withRuntimeMeta(catalogEntry('summary.sampleStatus'), runtime),
      }),
    ];

    const breakdown: TabBreakdown = buildBreakdown({
      title: 'Cases by health facility',
      columns: [
        { key: 'name', label: 'Facility', align: 'text', pending: false },
        { key: 'alerts', label: 'Alerts', align: 'num', pending: false },
        { key: 'confirmed', label: 'Confirmed', align: 'num', pending: false },
        {
          key: 'currentAdmitted',
          label: 'Current admitted',
          align: 'num',
          pending: true,
        },
        { key: 'recovered', label: 'Recovered', align: 'num', pending: false },
        { key: 'deaths', label: 'Deaths', align: 'num', pending: false },
      ],
      rows: facilityGroups.rows,
      total: facilityGroups.total,
      shown: facilityGroups.rows.length,
      provenance: facilityProvenance,
      meta: withRuntimeMeta(catalogEntry('summary.facilityBreakdown'), runtime),
    });

    return {
      meta: {
        tab: 'summary',
        filters: {
          period: filters.period,
          from: filters.from ?? null,
          to: filters.to ?? null,
        },
        window,
        provenance: {
          alerts: caseProvenance,
          cases: caseProvenance,
          outcomes: outcomeProvenance,
          screening: screeningProvenance,
          community: verifiedIsDefined ? communityProvenance : noSignalsInScope,
          laboratory: labProvenance,
          contacts: followUpGap,
          dailyFlow: flowProvenance,
          sampleStatus: labProvenance,
          facilityBreakdown: facilityProvenance,
        },
      },
      cards,
      charts,
      breakdown,
    };
  }

  private async one<T extends NumberRow>(
    sql: string,
    values?: unknown[],
  ): Promise<T> {
    const result = await this.analyticsDb.query<T>(sql, values);
    return result.rows[0] ?? ({} as T);
  }

  private async many<T extends NumberRow>(
    sql: string,
    values?: unknown[],
  ): Promise<T[]> {
    const result = await this.analyticsDb.query<T>(sql, values);
    return result.rows;
  }

  private resolveWindow(
    filters: OperationalFiltersDto,
    boundsMaxEventAt: string,
    nextParamIndex: number,
  ): { predicate: string; params: unknown[]; anchored: boolean } {
    if (filters.period === 'custom') {
      return {
        predicate:
          `event_at >= $${nextParamIndex}::timestamptz` +
          ` AND event_at <= $${nextParamIndex + 1}::timestamptz`,
        params: [filters.from, filters.to],
        anchored: false,
      };
    }

    if (filters.period === 'all') {
      return { predicate: 'event_at IS NOT NULL', params: [], anchored: false };
    }

    const interval = PERIOD_INTERVALS[filters.period];
    return {
      predicate:
        `event_at > ${boundsMaxEventAt} - interval '${interval}'` +
        ` AND event_at <= ${boundsMaxEventAt}`,
      params: [],
      anchored: true,
    };
  }

  private labScope(filters: OperationalFiltersDto): ScopedQuery {
    const params: unknown[] = [EVD_LAB_TEST_CODE];
    const window = this.resolveWindow(
      filters,
      'bounds.max_event_at',
      params.length + 1,
    );
    params.push(...window.params);

    const clauses = [window.predicate];

    if (typeof filters.lab === 'string' && filters.lab.length > 0) {
      params.push(filters.lab);
      clauses.push(
        `lower(btrim(testing_laboratory_name)) = lower(btrim($${params.length}))`,
      );
    }

    for (const [key, column] of LAB_FILTER_COLUMNS) {
      const value = filters[key];
      if (typeof value === 'string' && value.length > 0) {
        params.push(value);
        clauses.push(`${column} = $${params.length}`);
      }
    }

    const sql = `
      WITH base AS (
        SELECT
          total_test_count,
          positive_test_count,
          negative_test_count,
          inconclusive_test_count,
          other_result_count,
          unknown_result_count,
          result_not_available_count,
          result_category,
          specimen_type,
          test_name,
          turnaround_time_band,
          reporting_testing_laboratory_name,
          testing_laboratory_name,
          ingested_at,
          coalesce(
            result_datetime,
            reporting_result_date::timestamptz,
            collection_date::timestamptz
          ) AS event_at
        FROM gold.report_lab_result
        WHERE test_code = $1
      ),
      bounds AS (
        SELECT
          max(event_at) AS max_event_at,
          max(ingested_at) AS max_ingested_at
        FROM base
      ),
      scoped AS (
        SELECT base.*
        FROM base
        CROSS JOIN bounds
        WHERE ${clauses.join('\n          AND ')}
      )`;

    return { sql, params, anchored: window.anchored };
  }

  private async labSummary(filters: OperationalFiltersDto) {
    const scope = this.labScope(filters);
    const row = await this.one(
      `${scope.sql}
      SELECT
        coalesce(sum(total_test_count), 0)::int AS tests_done,
        coalesce(sum(positive_test_count), 0)::int AS positive_tests,
        ${NEGATIVE_TESTS_EXPR} AS negative_tests,
        ${WINDOW_AND_FRESHNESS_COLUMNS}
      FROM scoped
    `,
      scope.params,
    );

    return {
      testsDone: num(row.tests_done),
      positiveTests: num(row.positive_tests),
      negativeTests: num(row.negative_tests),
      ...sectionBounds(row),
      anchored: scope.anchored,
    };
  }

  private async labBreakdown(filters: OperationalFiltersDto) {
    const scope = this.labScope(filters);
    const rows = await this.many(
      `${scope.sql},
      grouped AS (
        SELECT
          coalesce(
            nullif(reporting_testing_laboratory_name, ''),
            nullif(testing_laboratory_name, ''),
            'Not recorded'
          ) AS name,
          CASE
            WHEN count(*) = count(nullif(testing_laboratory_name, ''))
             AND count(DISTINCT nullif(testing_laboratory_name, '')) = 1
              THEN min(nullif(testing_laboratory_name, ''))
          END AS filter_value,
          coalesce(sum(total_test_count), 0)::int AS tests,
          coalesce(sum(positive_test_count), 0)::int AS positive,
          ${NEGATIVE_TESTS_EXPR} AS negative
        FROM scoped
        GROUP BY 1
      )
      SELECT
        name,
        filter_value,
        tests,
        positive,
        negative,
        (SELECT count(*) FROM grouped)::int AS total_groups
      FROM grouped
      ORDER BY tests DESC, name ASC
      LIMIT ${BREAKDOWN_LIMIT}
    `,
      scope.params,
    );

    return {
      total: rows.length > 0 ? num(rows[0].total_groups) : 0,
      rows: rows.map((row) => ({
        name: String(row.name),
        filterValue:
          typeof row.filter_value === 'string' && row.filter_value.length > 0
            ? row.filter_value
            : null,
        tests: num(row.tests),
        positive: num(row.positive),
        negative: num(row.negative),
      })),
    };
  }

  private poeScope(filters: OperationalFiltersDto): ScopedQuery {
    const params: unknown[] = [POE_SURVEILLANCE_PATHWAY];
    const window = this.resolveWindow(
      filters,
      'bounds.max_event_at',
      params.length + 1,
    );
    params.push(...window.params);

    const clauses = [window.predicate];

    if (typeof filters.poe === 'string' && filters.poe.length > 0) {
      params.push(filters.poe);
      clauses.push(
        `lower(btrim(reporting_point_of_entry)) = lower(btrim($${params.length}))`,
      );
    }

    for (const [key, column] of POE_FILTER_COLUMNS) {
      const value = filters[key];
      if (typeof value === 'string' && value.length > 0) {
        params.push(value);
        clauses.push(
          `lower(btrim(${column})) = lower(btrim($${params.length}))`,
        );
      }
    }

    const sql = `
      WITH base AS (
        SELECT
          total_screening_count,
          reporting_point_of_entry,
          point_of_entry,
          screening_outcome,
          reporting_screening_category,
          ingested_at,
          coalesce(
            screening_datetime,
            reporting_date::timestamptz
          ) AS event_at
        FROM gold.report_screening
        WHERE surveillance_pathway = $1
      ),
      bounds AS (
        SELECT
          max(event_at) AS max_event_at,
          max(ingested_at) AS max_ingested_at
        FROM base
      ),
      scoped AS (
        SELECT base.*
        FROM base
        CROSS JOIN bounds
        WHERE ${clauses.join('\n          AND ')}
      )`;

    return { sql, params, anchored: window.anchored };
  }

  private async poeSummary(filters: OperationalFiltersDto) {
    const scope = this.poeScope(filters);
    const row = await this.one(
      `${scope.sql}
      SELECT
        coalesce(sum(total_screening_count), 0)::int AS travellers_screened,
        ${WINDOW_AND_FRESHNESS_COLUMNS}
      FROM scoped
    `,
      scope.params,
    );

    return {
      travellersScreened: num(row.travellers_screened),
      ...sectionBounds(row),
      anchored: scope.anchored,
    };
  }

  private async poeBreakdown(filters: OperationalFiltersDto) {
    const scope = this.poeScope(filters);
    const rows = await this.many(
      `${scope.sql},
      grouped_poe AS (
        SELECT
          ${POE_GROUP_EXPRESSION} AS name,
          CASE
            WHEN count(*) = count(nullif(reporting_point_of_entry, ''))
             AND count(DISTINCT nullif(reporting_point_of_entry, '')) = 1
              THEN min(nullif(reporting_point_of_entry, ''))
          END AS filter_value,
          coalesce(sum(total_screening_count), 0)::int AS screened
        FROM scoped
        GROUP BY 1
      )
      SELECT
        name,
        filter_value,
        screened,
        count(*) OVER ()::int AS total_groups
      FROM grouped_poe
      ORDER BY screened DESC, name ASC
      LIMIT ${BREAKDOWN_LIMIT}
    `,
      scope.params,
    );

    return {
      total: rows.length > 0 ? num(rows[0].total_groups) : 0,
      rows: rows.map((row) => ({
        name: String(row.name),
        filterValue:
          typeof row.filter_value === 'string' && row.filter_value.length > 0
            ? row.filter_value
            : null,
        screened: num(row.screened),
      })),
    };
  }

  private hfScope(filters: OperationalFiltersDto): ScopedQuery {
    const params: unknown[] = [HF_SCREENING_SOURCE_SYSTEM];
    const window = this.resolveWindow(
      filters,
      'bounds.max_event_at',
      params.length + 1,
    );
    params.push(...window.params);

    const clauses = [window.predicate];
    if (typeof filters.facility === 'string' && filters.facility.length > 0) {
      params.push(filters.facility);
      clauses.push(
        `lower(btrim(${HF_FACILITY_EXPRESSION})) = lower(btrim($${params.length}))`,
      );
    }

    const sql = `
      WITH base AS (
        SELECT
          reporting_facility_name,
          facility_name,
          flagged_screening_count,
          total_screening_count,
          ingested_at,
          coalesce(
            screening_datetime,
            reporting_date::timestamptz
          ) AS event_at
        FROM gold.report_screening
        WHERE source_system = $1
      ),
      bounds AS (
        SELECT
          max(event_at) AS max_event_at,
          max(ingested_at) AS max_ingested_at
        FROM base
      ),
      scoped AS (
        SELECT base.*
        FROM base
        CROSS JOIN bounds
        WHERE ${clauses.join('\n          AND ')}
      )`;

    return { sql, params, anchored: window.anchored };
  }

  private async hfSummary(filters: OperationalFiltersDto) {
    const scope = this.hfScope(filters);
    const row = await this.one(
      `${scope.sql}
      SELECT
        coalesce(sum(total_screening_count), 0)::int AS total,
        coalesce(sum(flagged_screening_count), 0)::int AS alerts,
        to_char(min(event_at), 'YYYY-MM-DD') AS window_from,
        to_char(max(event_at), 'YYYY-MM-DD') AS window_to,
        (
          SELECT to_char(max_ingested_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
          FROM bounds
        ) AS last_updated
      FROM scoped
    `,
      scope.params,
    );

    return {
      total: num(row.total),
      alerts: num(row.alerts),
      windowFrom: stringValue(row.window_from),
      windowTo: stringValue(row.window_to),
      lastUpdated: stringValue(row.last_updated),
      anchored: scope.anchored,
    };
  }

  private async hfBreakdown(filters: OperationalFiltersDto) {
    const scope = this.hfScope(filters);
    const rows = await this.many(
      `${scope.sql},
      facility_groups AS (
        SELECT
          ${HF_FACILITY_EXPRESSION} AS name,
          CASE
            WHEN ${HF_FACILITY_EXPRESSION} <> 'Not recorded'
              THEN ${HF_FACILITY_EXPRESSION}
          END AS filter_value,
          coalesce(sum(flagged_screening_count), 0)::int AS alerts,
          0::int AS confirmed,
          coalesce(sum(total_screening_count), 0)::int AS screenings
        FROM scoped
        GROUP BY 1
      )
      SELECT
        name,
        filter_value,
        screenings AS screened,
        alerts,
        confirmed,
        0::int AS current_admitted,
        0::int AS recovered,
        0::int AS deaths,
        count(*) OVER ()::int AS total_groups
      FROM facility_groups
      ORDER BY screenings DESC, name ASC
      LIMIT ${BREAKDOWN_LIMIT}
    `,
      scope.params,
    );

    return {
      total: rows.length > 0 ? num(rows[0].total_groups) : 0,
      rows: rows.map((row) => ({
        name: String(row.name),
        filterValue:
          typeof row.filter_value === 'string' && row.filter_value.length > 0
            ? row.filter_value
            : null,
        screened: num(row.screened),
        alerts: num(row.alerts),
        confirmed: 0,
        currentAdmitted: 0,
        recovered: 0,
        deaths: 0,
      })),
    };
  }

  private contactScope(filters: OperationalFiltersDto): ScopedQuery {
    const params: unknown[] = [];
    const window = this.resolveWindow(
      filters,
      'bounds.max_event_at',
      params.length + 1,
    );
    params.push(...window.params);

    const clauses = [window.predicate];

    if (
      typeof filters.classification === 'string' &&
      filters.classification.length > 0
    ) {
      params.push(filters.classification);
      clauses.push(
        `lower(btrim(final_classification)) = lower(btrim($${params.length}))`,
      );
    }

    const sql = `
      WITH base AS (
        SELECT
          total_contact_registration_count,
          final_classification,
          reporting_county,
          ingested_at,
          coalesce(
            registration_datetime,
            registration_date::timestamptz
          ) AS event_at
        FROM gold.report_contact_registration
      ),
      bounds AS (
        SELECT
          max(event_at) AS max_event_at,
          max(ingested_at) AS max_ingested_at
        FROM base
      ),
      scoped AS (
        SELECT base.*
        FROM base
        CROSS JOIN bounds
        WHERE ${clauses.join('\n          AND ')}
      )`;

    return { sql, params, anchored: window.anchored };
  }

  private async contactSummary(filters: OperationalFiltersDto) {
    const scope = this.contactScope(filters);
    const row = await this.one(
      `${scope.sql}
      SELECT
        coalesce(sum(total_contact_registration_count), 0)::int AS contacts_listed,
        ${WINDOW_AND_FRESHNESS_COLUMNS}
      FROM scoped
    `,
      scope.params,
    );

    return {
      contactsListed: num(row.contacts_listed),
      ...sectionBounds(row),
      anchored: scope.anchored,
    };
  }

  private async contactsByCounty(filters: OperationalFiltersDto) {
    const scope = this.contactScope(filters);
    const rows = await this.many(
      `${scope.sql},
      grouped_county AS (
        SELECT
          ${CONTACT_GROUP_EXPRESSION} AS name,
          coalesce(sum(total_contact_registration_count), 0)::int AS listed
        FROM scoped
        GROUP BY 1
      )
      SELECT
        name,
        listed,
        count(*) OVER ()::int AS total_groups
      FROM grouped_county
      ORDER BY listed DESC, name ASC
      LIMIT ${BREAKDOWN_LIMIT}
    `,
      scope.params,
    );

    return {
      total: rows.length > 0 ? num(rows[0].total_groups) : 0,
      rows: rows.map((row) => ({
        name: String(row.name),
        listed: num(row.listed),
      })),
    };
  }

  private communityScope(filters: OperationalFiltersDto): ScopedQuery {
    const params: unknown[] = [];
    const window = this.resolveWindow(
      filters,
      'bounds.max_event_at',
      params.length + 1,
    );
    params.push(...window.params);

    const clauses = [window.predicate];

    for (const [key, column] of COMMUNITY_FILTER_COLUMNS) {
      const value = filters[key];
      if (typeof value === 'string' && value.length > 0) {
        params.push(value);
        clauses.push(
          `lower(btrim(${column})) = lower(btrim($${params.length}))`,
        );
      }
    }

    const sql = `
      WITH base AS (
        SELECT
          signals_reported,
          signals_verified,
          signals_verified_true,
          signals_investigated,
          county,
          source_system,
          _ingested_at AS ingested_at,
          created_date::timestamptz AS event_at
        FROM gold.report_community_signals
      ),
      bounds AS (
        SELECT
          max(event_at) AS max_event_at,
          max(ingested_at) AS max_ingested_at
        FROM base
      ),
      scoped AS (
        SELECT base.*
        FROM base
        CROSS JOIN bounds
        WHERE ${clauses.join('\n          AND ')}
      )`;

    return { sql, params, anchored: window.anchored };
  }

  private async communitySummary(filters: OperationalFiltersDto) {
    const scope = this.communityScope(filters);
    const row = await this.one(
      `${scope.sql}
      SELECT
        coalesce(sum(signals_reported), 0)::int AS signals_reported,
        coalesce(sum(signals_verified), 0)::int AS signals_verified,
        sum(signals_verified)::float8
          / nullif(sum(signals_reported), 0)
          * 100 AS verified_share,
        ${WINDOW_AND_FRESHNESS_COLUMNS}
      FROM scoped
    `,
      scope.params,
    );

    const share = nullableNum(row.verified_share);

    return {
      signalsReported: num(row.signals_reported),
      signalsVerified: num(row.signals_verified),
      verifiedShare: share === null ? null : Math.round(share * 10) / 10,
      ...sectionBounds(row),
      anchored: scope.anchored,
    };
  }

  private async communityByCounty(filters: OperationalFiltersDto) {
    const scope = this.communityScope(filters);
    const rows = await this.many(
      `${scope.sql},
      grouped_county AS (
        SELECT
          ${COMMUNITY_GROUP_EXPRESSION} AS name,
          coalesce(sum(signals_reported), 0)::int AS reported,
          coalesce(sum(signals_verified), 0)::int AS verified
        FROM scoped
        GROUP BY 1
      )
      SELECT
        name,
        reported,
        verified,
        count(*) OVER ()::int AS total_groups
      FROM grouped_county
      ORDER BY reported DESC, name ASC
      LIMIT ${BREAKDOWN_LIMIT}
    `,
      scope.params,
    );

    return {
      total: rows.length > 0 ? num(rows[0].total_groups) : 0,
      rows: rows.map((row) => ({
        name: String(row.name),
        reported: num(row.reported),
        verified: num(row.verified),
      })),
    };
  }

  private windowScope(
    filters: OperationalFiltersDto,
    spec: {
      columns: string;
      from: string;
      eventExpr: string;
      baseWhere?: string;
      leadingParams?: readonly unknown[];
      ingestedAtColumn?: string;
    },
  ): ScopedQuery {
    const params: unknown[] = [...(spec.leadingParams ?? [])];
    const window = this.resolveWindow(
      filters,
      'bounds.max_event_at',
      params.length + 1,
    );
    params.push(...window.params);

    const sql = `
      WITH base AS (
        SELECT
          ${spec.columns},
          ${spec.ingestedAtColumn ?? 'ingested_at'} AS ingested_at,
          ${spec.eventExpr} AS event_at
        FROM ${spec.from}
        ${spec.baseWhere ? `WHERE ${spec.baseWhere}` : ''}
      ),
      bounds AS (
        SELECT
          max(event_at) AS max_event_at,
          max(ingested_at) AS max_ingested_at
        FROM base
      ),
      scoped AS (
        SELECT base.*
        FROM base
        CROSS JOIN bounds
        WHERE ${window.predicate}
      )`;

    return { sql, params, anchored: window.anchored };
  }

  private async summaryCases(filters: OperationalFiltersDto) {
    const scope = this.windowScope(filters, {
      columns: `initial_suspected_count,
          initial_probable_count,
          final_confirmed_count,
          open_investigation_count,
          sample_collected_count`,
      from: 'gold.report_case_investigation',
      eventExpr: `coalesce(
            investigation_datetime,
            reporting_date::timestamptz
          )`,
    });

    const row = await this.one(
      `${scope.sql}
      SELECT
        coalesce(sum(initial_suspected_count), 0)::int AS suspected,
        coalesce(sum(initial_probable_count), 0)::int AS probable,
        coalesce(
          sum(initial_suspected_count) + sum(initial_probable_count),
          0
        )::int AS alerts,
        coalesce(sum(final_confirmed_count), 0)::int AS confirmed_cases,
        coalesce(sum(open_investigation_count), 0)::int AS cases_for_review,
        coalesce(sum(sample_collected_count), 0)::int AS samples_collected,
        ${WINDOW_AND_FRESHNESS_COLUMNS}
      FROM scoped
    `,
      scope.params,
    );

    return {
      suspected: num(row.suspected),
      probable: num(row.probable),
      alerts: num(row.alerts),
      confirmedCases: num(row.confirmed_cases),
      casesForReview: num(row.cases_for_review),
      samplesCollected: num(row.samples_collected),
      ...sectionBounds(row),
      anchored: scope.anchored,
    };
  }

  private async summaryOutcomes(filters: OperationalFiltersDto) {
    const scope = this.windowScope(filters, {
      columns: `on_treatment_count,
          recovered_count,
          deceased_count`,
      from: 'gold.report_treatment_outcome',
      eventExpr: `coalesce(
            outcome_recorded_datetime,
            outcome_date::timestamptz,
            reporting_date::timestamptz
          )`,
    });

    const row = await this.one(
      `${scope.sql}
      SELECT
        coalesce(sum(on_treatment_count), 0)::int AS on_treatment,
        coalesce(sum(recovered_count), 0)::int AS recovered,
        coalesce(sum(deceased_count), 0)::int AS deaths,
        ${WINDOW_AND_FRESHNESS_COLUMNS}
      FROM scoped
    `,
      scope.params,
    );

    return {
      onTreatment: num(row.on_treatment),
      recovered: num(row.recovered),
      deaths: num(row.deaths),
      ...sectionBounds(row),
    };
  }

  private async summaryScreenings(filters: OperationalFiltersDto) {
    const scope = this.windowScope(filters, {
      columns: `total_screening_count`,
      from: 'gold.report_screening',
      eventExpr: `coalesce(
            screening_datetime,
            reporting_date::timestamptz
          )`,
    });

    const row = await this.one(
      `${scope.sql}
      SELECT
        coalesce(sum(total_screening_count), 0)::int AS travellers_screened,
        ${WINDOW_AND_FRESHNESS_COLUMNS}
      FROM scoped
    `,
      scope.params,
    );

    return {
      travellersScreened: num(row.travellers_screened),
      ...sectionBounds(row),
    };
  }

  private async summaryCommunity(filters: OperationalFiltersDto) {
    const scope = this.windowScope(filters, {
      columns: `signals_reported,
          signals_verified`,
      from: 'gold.report_community_signals',
      ingestedAtColumn: '_ingested_at',
      eventExpr: `created_date::timestamptz`,
    });

    const row = await this.one(
      `${scope.sql}
      SELECT
        coalesce(sum(signals_reported), 0)::int AS signals_reported,
        coalesce(sum(signals_verified), 0)::int AS signals_verified,
        sum(signals_verified)::float8
          / nullif(sum(signals_reported), 0)
          * 100 AS verified_share,
        ${WINDOW_AND_FRESHNESS_COLUMNS}
      FROM scoped
    `,
      scope.params,
    );

    const share = nullableNum(row.verified_share);

    return {
      signalsReported: num(row.signals_reported),
      signalsVerified: num(row.signals_verified),
      verifiedShare: share === null ? null : Math.round(share * 10) / 10,
      ...sectionBounds(row),
    };
  }

  private async summaryLaboratory(filters: OperationalFiltersDto) {
    const scope = this.windowScope(filters, {
      columns: 'total_test_count,\n          positive_test_count',
      from: 'gold.report_lab_result',
      eventExpr: `coalesce(
            result_datetime,
            reporting_result_date::timestamptz,
            collection_date::timestamptz
          )`,
      baseWhere: 'test_code = $1',
      leadingParams: [EVD_LAB_TEST_CODE],
    });

    const row = await this.one(
      `${scope.sql}
      SELECT
        coalesce(sum(positive_test_count), 0)::int AS positive,
        ${NEGATIVE_TESTS_EXPR} AS negative,
        ${WINDOW_AND_FRESHNESS_COLUMNS}
      FROM scoped
    `,
      scope.params,
    );

    return {
      buckets: LAB_RESULT_BUCKETS.map((bucket) => ({
        name: bucket.name,
        value: num(row[bucket.key]),
        color: bucket.color,
      })),
      ...sectionBounds(row),
    };
  }

  private async summaryContacts(filters: OperationalFiltersDto) {
    const scope = this.windowScope(filters, {
      columns: `total_contact_registration_count`,
      from: 'gold.report_contact_registration',
      eventExpr: `coalesce(
            registration_datetime,
            registration_date::timestamptz
          )`,
    });

    const row = await this.one(
      `${scope.sql}
      SELECT
        ${WINDOW_AND_FRESHNESS_COLUMNS}
      FROM scoped
    `,
      scope.params,
    );

    return sectionBounds(row);
  }

  private async summaryDailyFlow(filters: OperationalFiltersDto) {
    const params: unknown[] = [EVD_LAB_TEST_CODE];
    const communityWindow = this.resolveWindow(
      filters,
      'community_bounds.max_event_at',
      params.length + 1,
    );
    params.push(...communityWindow.params);
    const labWindow = this.resolveWindow(filters, 'lab_bounds.max_event_at', 2);

    const rows = await this.many(
      `
      WITH community_base AS (
        SELECT
          signals_reported,
          signals_verified,
          created_date::timestamptz AS event_at
        FROM gold.report_community_signals
      ),
      community_bounds AS (
        SELECT max(event_at) AS max_event_at
        FROM community_base
      ),
      community_scoped AS (
        SELECT community_base.*
        FROM community_base
        CROSS JOIN community_bounds
        WHERE ${communityWindow.predicate}
      ),
      lab_base AS (
        SELECT
          total_test_count,
          reporting_collection_date,
          coalesce(
            result_datetime,
            reporting_result_date::timestamptz,
            collection_date::timestamptz
          ) AS event_at
        FROM gold.report_lab_result
        WHERE test_code = $1
      ),
      lab_bounds AS (
        SELECT max(event_at) AS max_event_at
        FROM lab_base
      ),
      lab_scoped AS (
        SELECT lab_base.*
        FROM lab_base
        CROSS JOIN lab_bounds
        WHERE ${labWindow.predicate}
      ),
      community_daily AS (
        SELECT
          date_trunc('day', event_at)::date AS day,
          coalesce(sum(signals_reported), 0)::int AS signals,
          coalesce(sum(signals_verified), 0)::int AS verified
        FROM community_scoped
        GROUP BY 1
      ),
      lab_daily AS (
        SELECT
          coalesce(reporting_collection_date, event_at::date) AS day,
          coalesce(sum(total_test_count), 0)::int AS samples
        FROM lab_scoped
        GROUP BY 1
      ),
      span AS (
        SELECT
          min(day) AS start_day,
          max(day) AS end_day
        FROM (
          SELECT day FROM community_daily
          UNION ALL
          SELECT day FROM lab_daily
        ) all_days
      ),
      days AS (
        SELECT generate_series(span.start_day, span.end_day, interval '1 day')::date AS day
        FROM span
        WHERE span.start_day IS NOT NULL
          AND span.end_day IS NOT NULL
      )
      SELECT
        to_char(days.day, 'YYYY-MM-DD') AS day,
        coalesce(community_daily.signals, 0)::int AS signals,
        coalesce(community_daily.verified, 0)::int AS verified,
        coalesce(lab_daily.samples, 0)::int AS samples
      FROM days
      LEFT JOIN community_daily ON community_daily.day = days.day
      LEFT JOIN lab_daily ON lab_daily.day = days.day
      ORDER BY days.day ASC
    `,
      params,
    );

    return rows.map((row) => ({
      day: String(row.day),
      signals: num(row.signals),
      verified: num(row.verified),
      samples: num(row.samples),
    }));
  }

  private async summaryFacilities(filters: OperationalFiltersDto) {
    const params: unknown[] = [];
    const caseWindow = this.resolveWindow(
      filters,
      'case_bounds.max_event_at',
      params.length + 1,
    );
    params.push(...caseWindow.params);
    const outcomeWindow = this.resolveWindow(
      filters,
      'outcome_bounds.max_event_at',
      1,
    );

    const facilityKey = `coalesce(nullif(btrim(health_facility), ''), '')`;

    const rows = await this.many(
      `
      WITH case_base AS (
        SELECT
          ${facilityKey} AS facility_key,
          initial_suspected_count,
          initial_probable_count,
          final_confirmed_count,
          coalesce(
            investigation_datetime,
            reporting_date::timestamptz
          ) AS event_at
        FROM gold.report_case_investigation
      ),
      case_bounds AS (
        SELECT max(event_at) AS max_event_at
        FROM case_base
      ),
      case_scoped AS (
        SELECT case_base.*
        FROM case_base
        CROSS JOIN case_bounds
        WHERE ${caseWindow.predicate}
      ),
      outcome_base AS (
        SELECT
          ${facilityKey} AS facility_key,
          recovered_count,
          deceased_count,
          coalesce(
            outcome_recorded_datetime,
            outcome_date::timestamptz,
            reporting_date::timestamptz
          ) AS event_at
        FROM gold.report_treatment_outcome
      ),
      outcome_bounds AS (
        SELECT max(event_at) AS max_event_at
        FROM outcome_base
      ),
      outcome_scoped AS (
        SELECT outcome_base.*
        FROM outcome_base
        CROSS JOIN outcome_bounds
        WHERE ${outcomeWindow.predicate}
      ),
      case_facility AS (
        SELECT
          facility_key,
          coalesce(
            sum(initial_suspected_count) + sum(initial_probable_count),
            0
          )::int AS alerts,
          coalesce(sum(final_confirmed_count), 0)::int AS confirmed
        FROM case_scoped
        GROUP BY 1
      ),
      outcome_facility AS (
        SELECT
          facility_key,
          coalesce(sum(recovered_count), 0)::int AS recovered,
          coalesce(sum(deceased_count), 0)::int AS deaths
        FROM outcome_scoped
        GROUP BY 1
      ),
      joined_facilities AS (
        SELECT
          coalesce(
            case_facility.facility_key,
            outcome_facility.facility_key
          ) AS facility_key,
          coalesce(case_facility.alerts, 0)::int AS alerts,
          coalesce(case_facility.confirmed, 0)::int AS confirmed,
          coalesce(outcome_facility.recovered, 0)::int AS recovered,
          coalesce(outcome_facility.deaths, 0)::int AS deaths
        FROM case_facility
        FULL OUTER JOIN outcome_facility
          ON case_facility.facility_key = outcome_facility.facility_key
      ),
      active_facilities AS (
        SELECT
          CASE
            WHEN facility_key = '' THEN 'Not recorded'
            ELSE facility_key
          END AS name,
          (facility_key = '') AS unrecorded,
          alerts,
          confirmed,
          recovered,
          deaths
        FROM joined_facilities
        WHERE alerts + confirmed + recovered + deaths > 0
      )
      SELECT
        name,
        alerts,
        confirmed,
        recovered,
        deaths,
        count(*) OVER ()::int AS total_groups
      FROM active_facilities
      ORDER BY unrecorded ASC, alerts DESC, confirmed DESC, name ASC
      LIMIT ${BREAKDOWN_LIMIT}
    `,
      params,
    );

    return {
      total: rows.length > 0 ? num(rows[0].total_groups) : 0,
      rows: rows.map((row) => ({
        name: String(row.name),
        alerts: num(row.alerts),
        confirmed: num(row.confirmed),
        currentAdmitted: null,
        recovered: num(row.recovered),
        deaths: num(row.deaths),
      })),
    };
  }
}
