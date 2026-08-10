import type { Provenance } from '../../common/analytics-helpers.js';

export type TabKey =
  | 'summary'
  | 'labs'
  | 'poe'
  | 'hf'
  | 'community'
  | 'contacts';

export interface TabWindow {
  period: '24h' | '7d' | '21d' | '42d' | 'all' | 'custom';
  from: string | null;
  to: string | null;
  anchored: boolean;
}

export type DataQualityStatus =
  | 'validated'
  | 'provisional'
  | 'incomplete'
  | 'unavailable';

export type SecurityClassification = 'public aggregate' | 'restricted aggregate';

export interface IndicatorMeta {
  indicatorId: string;
  displayName: string;
  securityClassification: SecurityClassification;
  dataQualityStatus: DataQualityStatus;
  definition?: string;
  countingUnit?: string;
  sourceSystem?: string[];
  coverage?: string;
  refreshFrequency?: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  allowedFilters?: string[];
  breakdown?: string[];
  lastUpdated?: string | null;
}

export interface TabCardBreakdownEntry {
  key: string;
  label: string;
  value: number | null;
  unit?: 'count' | 'percent' | 'days' | null;
}

export interface TabCard {
  key: string;
  label: string;
  emphasis: 'important' | 'plain';
  tone: 'red' | 'amber' | 'green' | 'blue' | 'navy';
  value: number | null;
  unit: 'count' | 'percent' | 'days' | null;
  detail: string | null;
  breakdown?: TabCardBreakdownEntry[];
  provenance: Provenance;
  meta?: IndicatorMeta;
}

export interface TabSeries {
  key: string;
  label: string;
  color: string;
}

export interface TabLinelistRef {
  dataset: string;
  filterKey: string;
  listLabel: string;
  noun: string;
}

export interface TabChart {
  key: string;
  title: string;
  subtitle: string | null;
  kind: 'bar' | 'line';
  orientation: 'vertical' | 'horizontal';
  height: number;
  categoryKey: string;
  series: TabSeries[];
  data: Record<string, string | number | null>[];
  fullWidth?: boolean;
  linelist?: TabLinelistRef;
  provenance: Provenance;
  meta?: IndicatorMeta;
}

export interface TabBreakdownColumn {
  key: string;
  label: string;
  align: 'text' | 'num';
  pending: boolean;
}

export interface TabBreakdown {
  title: string;
  columns: TabBreakdownColumn[];
  rows: Record<string, string | number | null>[];
  total: number;
  shown: number;
  linelist?: TabLinelistRef;
  provenance: Provenance;
  meta?: IndicatorMeta;
}

export interface TabPayload {
  meta: {
    tab: TabKey;
    filters: Record<string, string | null>;
    window: TabWindow;
    sources?: string[];
    provenance: Record<string, Provenance>;
  };
  cards: TabCard[];
  charts: TabChart[];
  breakdown: TabBreakdown | null;
}
