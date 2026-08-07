import { Inject, Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';

import {
  ANALYTICS_POSTGRES_POOL,
  type Queryable,
} from '../../database/database.module.js';
import type {
  FilterOptionsQueryDto,
  OperationalTab,
} from './dto/filter-options.dto.js';

export interface FilterOptionsPayload {
  labs: string[];
  poes: string[];
  facilities: string[];
  communitySources: string[];
}

export type FilterOptionKey = keyof FilterOptionsPayload;

export interface OptionSource {
  key: FilterOptionKey;
  filter: string;
  sql: string;
}

interface OptionRow extends QueryResultRow {
  value: unknown;
}

const OPTION_SOURCES: Readonly<Record<OperationalTab, readonly OptionSource[]>> =
  Object.freeze({
    summary: [],

    labs: [
      {
        key: 'labs',
        filter: 'lab',
        sql: `
          select distinct btrim(testing_laboratory_name) as value
          from gold.report_lab_result
          where coalesce(btrim(testing_laboratory_name), '') <> ''
          order by 1
        `,
      },
    ],

    poe: [
      {
        key: 'poes',
        filter: 'poe',
        sql: `
          select distinct btrim(reporting_point_of_entry) as value
          from gold.report_screening
          where coalesce(btrim(reporting_point_of_entry), '') <> ''
          order by 1
        `,
      },
    ],

    hf: [
      {
        key: 'facilities',
        filter: 'facility',
        sql: `
          select distinct coalesce(
            nullif(btrim(reporting_facility_name), ''),
            nullif(btrim(facility_name), '')
          ) as value
          from gold.report_screening
          where source_system = 'TAIFACARE_KENYAEMR'
            and coalesce(
              nullif(btrim(reporting_facility_name), ''),
              nullif(btrim(facility_name), '')
            ) is not null
          order by 1
        `,
      },
    ],

    community: [
      {
        key: 'communitySources',
        filter: 'communitySource',
        sql: `
          select distinct btrim(source_system) as value
          from gold.report_community_signals
          where coalesce(btrim(source_system), '') <> ''
          order by 1
        `,
      },
    ],

    contacts: [],
  });

const MIN_DISTINCT_VALUES_FOR_A_CONTROL = 2;

const OPTIONS_CACHE_TTL_MS = 10 * 60 * 1000;

interface CacheEntry {
  expiresAt: number;
  payload: FilterOptionsPayload;
}

const optionsCache = new Map<OperationalTab, CacheEntry>();

export function resetFilterOptionsCache(): void {
  optionsCache.clear();
}

function emptyPayload(): FilterOptionsPayload {
  return {
    labs: [],
    poes: [],
    facilities: [],
    communitySources: [],
  };
}

function clone(payload: FilterOptionsPayload): FilterOptionsPayload {
  return {
    labs: [...payload.labs],
    poes: [...payload.poes],
    facilities: [...payload.facilities],
    communitySources: [...payload.communitySources],
  };
}

@Injectable()
export class OperationalOptionsService {
  constructor(
    @Inject(ANALYTICS_POSTGRES_POOL) private readonly analyticsDb: Queryable,
  ) {}

  async getFilterOptions(
    query: FilterOptionsQueryDto,
  ): Promise<FilterOptionsPayload> {
    const cached = optionsCache.get(query.tab);
    if (cached && cached.expiresAt > Date.now()) return clone(cached.payload);

    const sources = OPTION_SOURCES[query.tab];
    const lists = await Promise.all(
      sources.map((option) => this.distinctValues(option.sql)),
    );

    const payload = emptyPayload();
    sources.forEach((option, index) => {
      payload[option.key] = lists[index];
    });

    optionsCache.set(query.tab, {
      expiresAt: Date.now() + OPTIONS_CACHE_TTL_MS,
      payload,
    });

    return clone(payload);
  }

  private async distinctValues(sql: string): Promise<string[]> {
    const result = await this.analyticsDb.query<OptionRow>(sql);

    const values = result.rows
      .map((row) => (typeof row.value === 'string' ? row.value.trim() : ''))
      .filter((value) => value.length > 0);

    return values.length < MIN_DISTINCT_VALUES_FOR_A_CONTROL ? [] : values;
  }
}

export const OPTION_SOURCE_TABLE = OPTION_SOURCES;
