import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';
import type { QueryResultRow } from 'pg';

import type { Queryable } from '../../database/database.module.js';
import { INDICATOR_CATALOG } from './indicator-catalog.js';
import { operationalFiltersSchema } from './dto/operational-filters.dto.js';
import {
  filterOptionsQuerySchema,
  operationalTabValues,
  type OperationalTab,
} from './dto/filter-options.dto.js';
import {
  OPTION_SOURCE_TABLE,
  OperationalOptionsService,
  resetFilterOptionsCache,
} from './operational-options.service.js';

const COLUMN_VALUES: Record<string, string[]> = {
  testing_laboratory_name: [
    'National Virology Reference Laboratory (NVRL)',
    'NVRL Mobile Laboratory 1',
    'NVRL Mobile Laboratory 2',
  ],
  reporting_point_of_entry: [
    'Busia One Stop Border Post',
    'Jomo Kenyatta International Airport',
    'Namanga One Stop Border Post',
  ],
  reporting_facility_name: [
    'Suba Sub County Hospital',
    'St Pius Musoli Health Centre',
    'St Monica Rapogi Hospital',
  ],
  reporting_age_group: ['0-4', '5-14', '15-24', '25-34'],
  signal_status: ['DISCARDED', 'GENERATED', 'VERIFIED'],
  signal_type: ['DEATH', 'ILLNESS', 'RUMOUR'],
  source_system: ['ECHIS', 'MDHARURA'],
  final_classification: ['CONTACT', 'DISCARDED'],
};

function columnFor(sql: string): string {
  const match = /btrim\((\w+)\)/.exec(sql);
  if (!match) throw new Error(`No distinct column in SQL: ${sql}`);
  return match[1];
}

function fakeDb(
  queries: string[],
  values: unknown[],
  overrides: Record<string, string[]> = {},
): Queryable {
  return {
    query<T extends QueryResultRow>(sql: string, params?: unknown[]) {
      queries.push(sql);
      values.push(params);

      const column = columnFor(sql);
      const rows = (overrides[column] ?? COLUMN_VALUES[column] ?? []).map(
        (value) => ({ value }),
      );

      return Promise.resolve({
        rows: rows as unknown as T[],
        rowCount: rows.length,
      });
    },
  };
}

async function run(
  tab: OperationalTab,
  overrides: Record<string, string[]> = {},
) {
  const queries: string[] = [];
  const values: unknown[] = [];
  const service = new OperationalOptionsService(
    fakeDb(queries, values, overrides),
  );
  const options = await service.getFilterOptions(
    filterOptionsQuerySchema.parse({ tab }),
  );
  return { queries, values, options };
}

beforeEach(() => {
  resetFilterOptionsCache();
});

describe('OperationalOptionsService', () => {
  it('sources the labs tab from one distinct scan over gold.report_lab_result', async () => {
    const { queries, options } = await run('labs');

    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('gold.report_lab_result');
    expect(queries[0]).toContain('select distinct');
    expect(options.labs).toEqual([
      'National Virology Reference Laboratory (NVRL)',
      'NVRL Mobile Laboratory 1',
      'NVRL Mobile Laboratory 2',
    ]);
  });

  it('sources facility options from TaifaCare screening rows', async () => {
    const { queries, options } = await run('hf');

    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('gold.report_screening');
    expect(queries[0]).toContain("source_system = 'TAIFACARE_KENYAEMR'");
    expect(options.facilities).toEqual([
      'Suba Sub County Hospital',
      'St Pius Musoli Health Centre',
      'St Monica Rapogi Hospital',
    ]);
  });

  it('offers no source-system control on the points-of-entry tab', async () => {
    const { queries, options } = await run('poe');

    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('gold.report_screening');
    expect(queries.join('\n')).not.toContain('source_system');
    expect(options.communitySources).toEqual([]);
    expect(options.poes).toHaveLength(3);
  });

  it('sources only the community source list for the community tab', async () => {
    const { queries, options } = await run('community');

    expect(queries).toHaveLength(1);
    expect(options.communitySources).toEqual(['ECHIS', 'MDHARURA']);
    expect(options).not.toHaveProperty('signalStatuses');
    expect(options).not.toHaveProperty('signalTypes');
  });

  it('drops a single-valued list to empty, because a no-op control is what SC-3 removes', async () => {
    const { options } = await run('community', { source_system: ['ECHIS'] });

    expect(options.communitySources).toEqual([]);
  });

  it('turns a control back on by itself once a second value appears', async () => {
    const { options } = await run('community', {
      source_system: ['ECHIS', 'KRCS', 'MDHARURA'],
    });

    expect(options.communitySources).toEqual(['ECHIS', 'KRCS', 'MDHARURA']);
  });

  it('leaves the community tab with no value control when its one source is single-valued', async () => {
    const { options } = await run('community', {
      source_system: ['MDHARURA'],
    });

    expect(options.communitySources).toEqual([]);
    expect(
      Object.values(options).filter((list) => list.length > 0),
    ).toHaveLength(0);
  });

  it('returns the whole payload shape, with empty lists for anything the tab does not source', async () => {
    const { queries, options } = await run('summary');

    expect(queries).toHaveLength(0);
    expect(Object.keys(options).sort()).toEqual([
      'communitySources',
      'facilities',
      'labs',
      'poes',
    ]);
    expect(Object.values(options).every((list) => list.length === 0)).toBe(true);
  });

  it('binds nothing at all — no statement carries a placeholder, because no value is accepted', async () => {
    const seen: string[] = [];
    const bound: unknown[] = [];

    for (const tab of operationalTabValues) {
      resetFilterOptionsCache();
      const { queries, values } = await run(tab);
      seen.push(...queries);
      bound.push(...values);
    }

    expect(seen.join('\n')).not.toMatch(/\$\d/);
    expect(bound.every((params) => params === undefined)).toBe(true);
  });

  it('serves a repeat request inside the TTL from cache without issuing a query', async () => {
    const queries: string[] = [];
    const values: unknown[] = [];
    const service = new OperationalOptionsService(fakeDb(queries, values));
    const input = filterOptionsQuerySchema.parse({ tab: 'community' });

    const first = await service.getFilterOptions(input);
    expect(queries).toHaveLength(1);

    const second = await service.getFilterOptions(input);
    expect(queries).toHaveLength(1);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });

  it('reads gold only, and offers no county, subcounty or ward dimension', async () => {
    const seen: string[] = [];

    for (const tab of operationalTabValues) {
      resetFilterOptionsCache();
      const { queries } = await run(tab);
      seen.push(...queries);
    }

    const sql = seen.join('\n');
    expect(sql).toMatch(/gold\.report_/);
    expect(sql).not.toMatch(/\b(bronze|silver)\./);
    expect(sql).not.toMatch(/\bmarts\./);

    expect(sql).not.toContain('reporting_county');
    expect(sql).not.toContain('reporting_subcounty');
    expect(sql).not.toContain('county');
    expect(sql).not.toContain('subcounty');
    expect(sql).not.toMatch(/\bward\b/);
    expect(sql).not.toContain('community_unit');
  });
});

describe('option lists against the declared contract', () => {
  const catalogueTabs = new Set(
    Object.keys(INDICATOR_CATALOG).map((id) => id.split('.')[0]),
  );

  it('names a filter the operational filters DTO accepts', () => {
    for (const sources of Object.values(OPTION_SOURCE_TABLE)) {
      for (const option of sources) {
        const parsed = operationalFiltersSchema.parse({
          [option.filter]: 'a value gold produced',
        }) as Record<string, unknown>;

        expect(parsed[option.filter]).toBe('a value gold produced');
      }
    }
  });

  it('names a filter the indicator catalogue admits, for every tab it covers', () => {
    for (const [tab, sources] of Object.entries(OPTION_SOURCE_TABLE)) {
      if (!catalogueTabs.has(tab)) continue;

      const allowed = Object.entries(INDICATOR_CATALOG)
        .filter(([id]) => id.startsWith(`${tab}.`))
        .flatMap(([, entry]) => entry.allowedFilters ?? []);

      for (const option of sources) {
        expect(allowed).toContain(option.filter);
      }
    }
  });
});

describe('every operational service reads gold only', () => {
  const moduleDir = join(process.cwd(), 'src', 'modules', 'operational');
  const serviceFiles = readdirSync(moduleDir).filter(
    (file) => file.endsWith('.service.ts') && !file.endsWith('.spec.ts'),
  );

  it('enumerates at least the two services this phase has authored so far', () => {
    expect(serviceFiles).toContain('operational.service.ts');
    expect(serviceFiles).toContain('operational-options.service.ts');
  });

  it.each(serviceFiles)('%s names no other medallion layer', (file) => {
    const source = readFileSync(join(moduleDir, file), 'utf8');

    expect(source).not.toMatch(/\b(bronze|silver|marts)\./);
    expect(source).not.toMatch(
      /dim_(facilitylist|point_of_entry|laboratory|location)/,
    );
  });
});
