import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import {
  catalogEntry,
  INDICATOR_CATALOG,
  withRuntimeMeta,
  type IndicatorCatalogEntry,
} from './indicator-catalog.js';

const NOW = new Date('2026-08-04T16:25:00.000Z');

const HOURS = 3600 * 1000;
const HALF_HOUR_OLD = new Date(NOW.getTime() - 0.5 * HOURS).toISOString();
const TWELVE_HOURS_OLD = new Date(NOW.getTime() - 12 * HOURS).toISOString();
const FOUR_DAYS_OLD = new Date(NOW.getTime() - 96 * HOURS).toISOString();
const EIGHT_DAYS_OLD = new Date(NOW.getTime() - 192 * HOURS).toISOString();

describe('INDICATOR_CATALOG', () => {
  it('keys every entry by its own indicatorId', () => {
    for (const [key, entry] of Object.entries(INDICATOR_CATALOG)) {
      expect(entry.indicatorId).toBe(key);
    }
  });

  it('never carries a blank value for a present field — an omitted field is absent, not empty', () => {
    for (const entry of Object.values(INDICATOR_CATALOG)) {
      for (const [field, value] of Object.entries(entry)) {
        if (typeof value === 'string') {
          expect(value.trim(), `${entry.indicatorId}.${field}`).not.toBe('');
        }
        if (Array.isArray(value)) {
          expect(value.length, `${entry.indicatorId}.${field}`).toBeGreaterThan(
            0,
          );
          for (const item of value) {
            expect(String(item).trim()).not.toBe('');
          }
        }
      }
    }
  });

  it('catalogues the three D-31 Laboratory cards plus the chart and breakdown', () => {
    const labKeys = Object.keys(INDICATOR_CATALOG)
      .filter((key) => key.startsWith('labs.'))
      .sort();

    expect(labKeys).toEqual([
      'labs.byLaboratory',
      'labs.negativeTests',
      'labs.positiveTests',
      'labs.resultStatusChart',
      'labs.testsDone',
    ]);
    for (const key of labKeys) {
      expect(INDICATOR_CATALOG[key].countingUnit).toBe(
        'laboratory test events',
      );
    }
  });

  it('classifies every indicator on every tab as a restricted aggregate', () => {
    for (const entry of Object.values(INDICATOR_CATALOG)) {
      expect(
        entry.securityClassification,
        entry.indicatorId,
      ).toBe('restricted aggregate');
    }
  });

  it('ages no entry out, however old the load', () => {
    const ancient = '2019-01-01T00:00:00.000Z';

    for (const [id, entry] of Object.entries(INDICATOR_CATALOG)) {
      const meta = withRuntimeMeta(entry, { lastUpdated: ancient });
      expect(meta?.dataQualityStatus, id).toBe(entry.baselineQualityStatus);
      expect(meta?.dataQualityStatus, id).not.toBe('stale');
    }
  });
});

describe('withRuntimeMeta', () => {
  it('returns undefined for an unknown indicator id', () => {
    expect(catalogEntry('labs.notAnIndicator')).toBeUndefined();
    expect(
      withRuntimeMeta(catalogEntry('labs.notAnIndicator'), { now: NOW }),
    ).toBeUndefined();
  });

  it('resolves to the baseline status when lastUpdated is inside the freshness window', () => {
    const meta = withRuntimeMeta(catalogEntry('labs.testsDone'), {
      lastUpdated: '2026-08-04T04:00:00.000Z',
      periodStart: '2026-07-04',
      periodEnd: '2026-07-25',
      now: NOW,
    });

    expect(meta?.dataQualityStatus).toBe('provisional');
    expect(meta?.periodStart).toBe('2026-07-04');
    expect(meta?.periodEnd).toBe('2026-07-25');
    expect(meta?.lastUpdated).toBe('2026-08-04T04:00:00.000Z');
  });

  it('reports the load timestamp without letting it decide the status', () => {
    const veryOld = '2019-01-01T00:00:00.000Z';
    const meta = withRuntimeMeta(catalogEntry('labs.testsDone'), {
      lastUpdated: veryOld,
    });

    expect(meta?.lastUpdated).toBe(veryOld);
    expect(meta?.dataQualityStatus).toBe('provisional');
  });

  it('treats a cadenceless entry exactly like one that declares a cadence', () => {
    const cadenceless: IndicatorCatalogEntry = {
      indicatorId: 'test.noCadence',
      displayName: 'Indicator with no declared cadence',
      securityClassification: 'restricted aggregate',
      baselineQualityStatus: 'validated',
    };

    const meta = withRuntimeMeta(cadenceless, {
      lastUpdated: '2019-01-01T00:00:00.000Z',
    });

    expect(meta?.dataQualityStatus).toBe('validated');
    expect(meta?.refreshFrequency).toBeUndefined();
  });

  it('resolves a pending indicator to unavailable regardless of freshness', () => {
    const meta = withRuntimeMeta(catalogEntry('labs.testsDone'), {
      pending: true,
      lastUpdated: '2026-08-04T16:00:00.000Z',
      now: NOW,
    });

    expect(meta?.dataQualityStatus).toBe('unavailable');
  });

  it('omits fields the register does not answer rather than blanking them', () => {
    const meta = withRuntimeMeta(catalogEntry('labs.positiveTests'), {
      now: NOW,
      lastUpdated: '2026-08-04T04:00:00.000Z',
    });

    expect(meta?.coverage).toBeUndefined();
    expect(meta?.breakdown).toBeUndefined();
    expect(Object.keys(meta ?? {})).not.toContain('coverage');
    expect(meta?.allowedFilters).toContain('resultStatus');
  });
});

describe('withRuntimeMeta — freshness reporting without a gate', () => {
  it('resolves the same status whatever the load age', () => {
    const statuses = [TWELVE_HOURS_OLD, FOUR_DAYS_OLD, EIGHT_DAYS_OLD].map(
      (lastUpdated) =>
        withRuntimeMeta(catalogEntry('labs.testsDone'), { lastUpdated })
          ?.dataQualityStatus,
    );

    expect(statuses).toEqual(['provisional', 'provisional', 'provisional']);
  });

  it('carries the age forward as the one field that changes', () => {
    const fresh = withRuntimeMeta(catalogEntry('labs.testsDone'), {
      lastUpdated: TWELVE_HOURS_OLD,
    });
    const old = withRuntimeMeta(catalogEntry('labs.testsDone'), {
      lastUpdated: EIGHT_DAYS_OLD,
    });

    const changed = Object.keys({ ...fresh, ...old }).filter(
      (key) =>
        (fresh as Record<string, unknown>)[key] !==
        (old as Record<string, unknown>)[key],
    );

    expect(changed).toEqual(['lastUpdated']);
  });

  it('carries an unrecognised cadence without it affecting the status', () => {
    const unrecognised: IndicatorCatalogEntry = {
      indicatorId: 'test.fortnightly',
      displayName: 'Indicator with a cadence the map does not carry',
      securityClassification: 'restricted aggregate',
      baselineQualityStatus: 'validated',
      refreshFrequency: 'Fortnightly',
    };

    expect(
      withRuntimeMeta(unrecognised, { lastUpdated: EIGHT_DAYS_OLD })
        ?.dataQualityStatus,
    ).toBe('validated');
    expect(
      withRuntimeMeta(unrecognised, { lastUpdated: EIGHT_DAYS_OLD })
        ?.refreshFrequency,
    ).toBe('Fortnightly');
  });

  it('resolves a pending indicator ahead of any freshness arithmetic', () => {

    expect(
      withRuntimeMeta(catalogEntry('labs.testsDone'), {
        pending: true,
        lastUpdated: EIGHT_DAYS_OLD,
      })?.dataQualityStatus,
    ).toBe('unavailable');
  });

  it('reads freshness from the ingestion column and from nothing else', () => {
    const service = readFileSync(
      new URL('./operational.service.ts', import.meta.url),
      'utf8',
    );

    expect(service).toContain('max(ingested_at) AS max_ingested_at');
    expect(service).toContain('lastUpdated: stringValue(row.last_updated),');
    expect(service).not.toMatch(/max\(\s*warehouse_built_at\s*\)/);
    expect(service).not.toMatch(/warehouse_built_at,/);
  });
});
