import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { COLUMN_FORMATS, formatFor, type ColumnFormat } from './column-labels.js';
import * as columnRegistryModule from './column-registry.js';
import {
  DATASET_REGISTRIES,
  piiColumns,
  requestedPiiColumns,
  resolveFields,
  resolveSort,
  searchableColumns,
  type DatasetKey,
  type DatasetRegistry,
} from './column-registry.js';

interface DisplayColumn {
  name: string;
  label: string;
  sortable: boolean;
  format: ColumnFormat;
}

const resolveColumnSpecs = (
  columnRegistryModule as typeof columnRegistryModule & {
    resolveColumnSpecs?: (
      registry: DatasetRegistry,
      requested?: readonly string[],
      access?: { readonly allowPii?: boolean },
    ) => DisplayColumn[];
  }
).resolveColumnSpecs;

const resolveAvailableColumnSpecs = (
  columnRegistryModule as typeof columnRegistryModule & {
    resolveAvailableColumnSpecs?: (
      registry: DatasetRegistry,
      access?: { readonly allowPii?: boolean },
    ) => DisplayColumn[];
  }
).resolveAvailableColumnSpecs;

const COLUMN_FORMAT_VALUES: readonly ColumnFormat[] = [
  'date',
  'datetime',
  'number',
  'status',
  'identifier',
  'boolean',
  'text',
];

const SURROGATE_KEYS: Readonly<Record<DatasetKey, string>> = {
  labResults: 'lab_result_key',
  screenings: 'screening_key',
  cases: 'case_investigation_key',
  outcomes: 'treatment_outcome_key',
  contacts: 'contact_registration_key',
  signals: 'community_signal_key',
};

const datasetKeys = Object.keys(DATASET_REGISTRIES) as DatasetKey[];

function registryFor(key: DatasetKey): DatasetRegistry {
  return DATASET_REGISTRIES[key];
}

function defaultColumns(
  registry: DatasetRegistry,
  access?: { readonly allowPii?: boolean },
): string[] {
  return resolveFields(registry, undefined, access);
}

function firstPiiKey(registry: DatasetRegistry): string {
  const key = Object.keys(registry).find(
    (name) => registry[name].exposure === 'pii',
  );
  if (key === undefined) {
    throw new Error('registry declares no pii column');
  }
  return key;
}

describe('linelist display column contract', () => {
  it('labels all 77 distinct registry identifiers with human text', async () => {
    const modulePath = './column-labels.js';
    const labels = (await import(modulePath)) as {
      COLUMN_LABELS: Readonly<Record<string, string>>;
      labelFor(column: string): string;
    };
    const identifiers = [
      ...new Set(
        Object.values(DATASET_REGISTRIES).flatMap((registry) =>
          Object.values(registry).map((spec) => spec.column),
        ),
      ),
    ];

    expect(Object.keys(labels.COLUMN_LABELS)).toHaveLength(77);
    for (const identifier of identifiers) {
      expect(labels.labelFor(identifier).trim()).not.toBe('');
      if (identifier.includes('_')) {
        expect(labels.labelFor(identifier)).not.toBe(identifier);
      }
    }
  });

  it('rejects unknown and inherited object-property identifiers', async () => {
    const modulePath = './column-labels.js';
    const { labelFor } = (await import(modulePath)) as {
      labelFor(column: string): string;
    };

    expect(() => labelFor('definitely_not_a_column')).toThrow();
    expect(() => labelFor('constructor')).toThrow();
    expect(() => labelFor('toString')).toThrow();
  });

  it('resolves the same ordered names as resolveFields for both access states', () => {
    expect(typeof resolveColumnSpecs).toBe('function');

    for (const key of datasetKeys) {
      const registry = registryFor(key);
      const requested = Object.keys(registry);

      for (const access of [{ allowPii: false }, { allowPii: true }]) {
        const fields = resolveFields(registry, requested, access);
        const columns = resolveColumnSpecs?.(registry, requested, access) ?? [];

        expect(columns.map((column) => column.name)).toEqual(fields);
        for (const column of columns) {
          expect(column.sortable).toBe(registry[column.name].sortable);
        }
      }
    }
  });

  it('enumerates every access-permitted registry column independently of the active projection', () => {
    expect(typeof resolveAvailableColumnSpecs).toBe('function');

    for (const key of datasetKeys) {
      const registry = registryFor(key);

      for (const access of [{ allowPii: false }, { allowPii: true }]) {
        const expected = Object.values(registry)
          .filter((spec) => spec.exposure !== 'pii' || access.allowPii)
          .map((spec) => spec.column);
        const available = resolveAvailableColumnSpecs?.(registry, access) ?? [];

        expect(available.map((column) => column.name)).toEqual(expected);
        for (const column of available) {
          expect(column).toEqual({
            name: column.name,
            label: expect.any(String),
            sortable: registry[column.name].sortable,
            format: formatFor(column.name),
          });
        }
      }
    }
  });

  it('carries a format on every element of the active projection too', () => {
    expect(typeof resolveColumnSpecs).toBe('function');

    for (const key of datasetKeys) {
      const registry = registryFor(key);
      const requested = Object.keys(registry);

      for (const access of [{ allowPii: false }, { allowPii: true }]) {
        const columns = resolveColumnSpecs?.(registry, requested, access) ?? [];
        expect(columns.length).toBeGreaterThan(0);
        for (const column of columns) {
          expect(column.format).toBe(formatFor(column.name));
        }
      }
    }
  });

  it('resolves every registry identifier to one of the seven display formats', () => {
    const identifiers = [
      ...new Set(
        Object.values(DATASET_REGISTRIES).flatMap((registry) =>
          Object.values(registry).map((spec) => spec.column),
        ),
      ),
    ];

    for (const identifier of identifiers) {
      expect(COLUMN_FORMAT_VALUES).toContain(formatFor(identifier));
    }
  });

  it('falls back to text for unknown and inherited identifiers rather than throwing', () => {
    expect(formatFor('definitely_not_a_column')).toBe('text');
    expect(formatFor('constructor')).toBe('text');
    expect(formatFor('toString')).toBe('text');
    expect(formatFor('__proto__')).toBe('text');
    expect(() => formatFor('definitely_not_a_column')).not.toThrow();
  });

  it('formats every dataset surrogate key as an identifier', () => {
    for (const key of datasetKeys) {
      expect(formatFor(SURROGATE_KEYS[key])).toBe('identifier');
      expect(COLUMN_FORMATS[SURROGATE_KEYS[key]]).toBe('identifier');
    }
  });
});

describe('the registry covers exactly the six linelist datasets', () => {
  it('exposes one registry per gold dataset', () => {
    expect(datasetKeys).toEqual([
      'labResults',
      'screenings',
      'cases',
      'outcomes',
      'contacts',
      'signals',
    ]);
  });

  it('declares at least one potentially-identifying column on every dataset', () => {
    for (const key of datasetKeys) {
      expect(piiColumns(registryFor(key)).length).toBeGreaterThan(0);
    }
  });

  it('keys every entry to its own SQL identifier, so no key aliases a column', () => {
    for (const key of datasetKeys) {
      const registry = registryFor(key);
      for (const [name, spec] of Object.entries(registry)) {
        expect(spec.column).toBe(name);
      }
    }
  });
});

describe.each(datasetKeys)('%s surrogate key is requestable, not default', (key) => {
  const registry = registryFor(key);
  const surrogate = SURROGATE_KEYS[key];

  it('declares the surrogate key as a registry entry', () => {
    expect(Object.keys(registry)).toContain(surrogate);
    expect(registry[surrogate].column).toBe(surrogate);
  });

  it('leaves the surrogate key out of the default projection', () => {
    for (const access of [{ allowPii: false }, { allowPii: true }]) {
      expect(resolveFields(registry, undefined, access)).not.toContain(surrogate);
      expect(resolveFields(registry, [], access)).not.toContain(surrogate);
    }
  });

  it('still projects the surrogate key when a request names it', () => {
    expect(resolveFields(registry, [surrogate])).toEqual([surrogate]);
    expect(resolveFields(registry, [surrogate], { allowPii: true })).toEqual([
      surrogate,
    ]);
  });

  it('still offers the surrogate key to the column chooser', () => {
    const available = resolveAvailableColumnSpecs?.(registry, {}) ?? [];
    expect(available.map((column) => column.name)).toContain(surrogate);
  });

  it('changes nothing else about the surrogate key entry', () => {
    expect(registry[surrogate].exposure).toBe('authenticated');
    expect(registry[surrogate].sortable).toBe(false);
    expect(registry[surrogate].searchable).toBe(false);
  });
});

describe.each(datasetKeys)('%s exposure contract', (key) => {
  const registry = registryFor(key);

  it('keeps every pii column unsortable', () => {
    for (const spec of Object.values(registry)) {
      if (spec.exposure !== 'pii') continue;
      expect(spec.sortable).toBe(false);
    }
  });

  it('makes every pii column default and searchable', () => {
    for (const spec of Object.values(registry)) {
      if (spec.exposure !== 'pii') continue;
      expect(spec.byDefault).toBe(true);
      expect(spec.searchable).toBe(true);
    }
  });

  it('returns the access-appropriate default set when no fields are requested', () => {
    expect(resolveFields(registry)).toEqual(defaultColumns(registry));
    expect(resolveFields(registry, [])).toEqual(defaultColumns(registry));
    expect(
      resolveFields(registry, undefined, { allowPii: true }),
    ).toEqual(defaultColumns(registry, { allowPii: true }));
    expect(resolveFields(registry, [], { allowPii: true })).toEqual(
      defaultColumns(registry, { allowPii: true }),
    );
  });

  it('never includes a pii identifier in the default projection', () => {
    const projected = resolveFields(registry);
    for (const column of piiColumns(registry)) {
      expect(projected).not.toContain(column);
    }
  });

  it('drops an unknown field name rather than raising', () => {
    for (const access of [{ allowPii: false }, { allowPii: true }]) {
      expect(
        resolveFields(
          registry,
          ['definitely_not_a_column', 'password', '*'],
          access,
        ),
      ).toEqual(defaultColumns(registry, access));
    }
  });

  it('drops an inherited object property named as a field', () => {
    for (const access of [{ allowPii: false }, { allowPii: true }]) {
      expect(
        resolveFields(
          registry,
          ['constructor', 'toString', '__proto__'],
          access,
        ),
      ).toEqual(defaultColumns(registry, access));
    }
  });

  it('treats a non-empty fields request as the exact active projection', () => {
    const requested = Object.keys(registry).find(
      (name) => registry[name].exposure !== 'pii',
    );
    expect(requested).toBeDefined();

    expect(resolveFields(registry, [requested as string])).toEqual([requested]);
  });

  it('refuses a pii column to a caller with no pii access', () => {
    const piiKey = firstPiiKey(registry);

    expect(resolveFields(registry, [piiKey])).toEqual(defaultColumns(registry));
    expect(resolveFields(registry, [piiKey], {})).toEqual(
      defaultColumns(registry),
    );
    expect(resolveFields(registry, [piiKey], { allowPii: false })).toEqual(
      defaultColumns(registry),
    );
  });

  it('includes a pii column when an authorised caller names it', () => {
    const piiKey = firstPiiKey(registry);
    const projected = resolveFields(registry, [piiKey], { allowPii: true });

    expect(projected).toContain(registry[piiKey].column);
    expect(projected).toEqual([registry[piiKey].column]);
  });

  it('still serves the non-pii columns of a mixed request to an unauthorised caller', () => {
    const piiKey = firstPiiKey(registry);
    const extra = Object.keys(registry).find(
      (name) => !registry[name].byDefault && registry[name].exposure !== 'pii',
    );
    if (extra === undefined) return;

    expect(resolveFields(registry, [extra, piiKey])).toEqual([extra]);
  });

  it('reports the pii columns a request named, whether or not they were served', () => {
    const piiKey = firstPiiKey(registry);

    expect(requestedPiiColumns(registry, [piiKey])).toEqual([
      registry[piiKey].column,
    ]);
    expect(requestedPiiColumns(registry, ['not_a_column'])).toEqual([]);
    expect(requestedPiiColumns(registry, [])).toEqual([]);
    expect(requestedPiiColumns(registry)).toEqual([]);
  });

  it('scans every pii column with free-text search from the registry flags', () => {
    const searchable = searchableColumns(registry);
    expect(searchable).toEqual(
      Object.values(registry)
        .filter((spec) => spec.searchable)
        .map((spec) => spec.column),
    );
    for (const column of piiColumns(registry)) {
      expect(searchable).toContain(column);
    }
  });

  it('falls back when the sort name is unknown, hostile or unsortable', () => {
    const fallback = { column: 'fallback_column', direction: 'DESC' };

    expect(resolveSort(registry, undefined, 'asc', 'fallback_column')).toEqual(
      fallback,
    );
    expect(
      resolveSort(registry, 'not_a_column', 'asc', 'fallback_column'),
    ).toEqual(fallback);
    expect(
      resolveSort(
        registry,
        'id; DROP TABLE gold.report_community_signals',
        'asc',
        'fallback_column',
      ),
    ).toEqual(fallback);
    expect(
      resolveSort(registry, 'constructor', 'asc', 'fallback_column'),
    ).toEqual(fallback);

    const piiKey = firstPiiKey(registry);
    expect(resolveSort(registry, piiKey, 'asc', 'fallback_column')).toEqual(
      fallback,
    );

    const unsortable = Object.keys(registry).find(
      (name) => !registry[name].sortable,
    );
    if (unsortable !== undefined) {
      expect(
        resolveSort(registry, unsortable, 'asc', 'fallback_column'),
      ).toEqual(fallback);
    }
  });

  it('accepts only the two-value direction set', () => {
    const sortable = Object.keys(registry).find(
      (name) => registry[name].sortable,
    );
    expect(sortable).toBeDefined();
    if (sortable === undefined) return;

    expect(resolveSort(registry, sortable, 'asc', 'fallback_column')).toEqual({
      column: registry[sortable].column,
      direction: 'ASC',
    });
    expect(resolveSort(registry, sortable, 'desc', 'fallback_column')).toEqual({
      column: registry[sortable].column,
      direction: 'DESC',
    });

    for (const hostile of ['ASC', 'desc; DROP TABLE x', 'random', '']) {
      expect(resolveSort(registry, sortable, hostile, 'fallback_column')).toEqual(
        { column: 'fallback_column', direction: 'DESC' },
      );
    }
  });

  it('carries no ingestion-envelope or dimension-key column at all', () => {
    const names = Object.keys(registry);
    for (const forbidden of [
      'ingested_at',
      'batch_id',
      'source_file',
      'source_row_id',
    ]) {
      expect(names).not.toContain(forbidden);
    }
    expect(names.filter((name) => name.endsWith('_count'))).toEqual([]);
  });
});

describe('no aggregate service names a potentially-identifying column', () => {
  const moduleDir = join(process.cwd(), 'src', 'modules', 'operational');
  const aggregateFiles = [
    'operational.service.ts',
    'operational-options.service.ts',
  ];

  const allPii = [
    ...new Set(datasetKeys.flatMap((key) => piiColumns(registryFor(key)))),
  ];

  it('classifies every identifying column the registries still source', () => {
    expect(allPii.sort()).toEqual([
      'person_identifier',
      'person_name',
      'signal_description',
      'source_contact_identifier',
      'source_contact_name',
      'source_person_identifier',
      'source_person_name',
      'subject_identifier',
    ]);
  });

  it.each(aggregateFiles)('%s names no pii identifier', (file) => {
    const contents = readFileSync(join(moduleDir, file), 'utf8');
    for (const column of allPii) {
      expect(contents).not.toContain(column);
    }
  });
});
