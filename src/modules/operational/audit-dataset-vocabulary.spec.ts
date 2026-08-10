import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Queryable } from '../../database/database.module.js';
import { linelistExportQuerySchema } from './dto/linelist-export-query.dto.js';
import { linelistQuerySchema } from './dto/linelist-query.dto.js';
import { LinelistExportController } from './linelist-export.controller.js';
import type {
  LinelistExportResult,
  LinelistExportService,
} from './linelist-export.service.js';
import { LinelistService, type LinelistAccess } from './linelist.service.js';

const DATASETS = [
  ['labResults', 'subject_identifier'],
  ['screenings', 'person_name'],
  ['cases', 'source_person_identifier'],
  ['outcomes', 'source_person_name'],
  ['contacts', 'source_contact_identifier'],
  ['signals', 'signal_description'],
] as const;

const DENIED: LinelistAccess = {
  userId: 'u-9',
  role: 'admin',
  allowPii: false,
};

const GRANTED = { user: { id: 'u-9', role: 'admin,surveillance' } };

function exportResult(piiColumn: string): LinelistExportResult {
  return {
    columns: [
      { name: piiColumn, label: 'Identifier', sortable: false, format: 'text' },
    ],
    piiColumns: [piiColumn],
    window: { from: '2026-07-07', to: '2026-07-28' },
    rows: (async function* () {
      yield { [piiColumn]: 'Amina' };
    })(),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function responseDouble() {
  const response = {
    headersSent: false,
    destroyed: false,
    setHeader: vi.fn(),
    write: vi.fn(() => {
      response.headersSent = true;
      return true;
    }),
    end: vi.fn(),
    destroy: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
  };
  return response;
}

async function exportedDataset(
  handler: (typeof DATASETS)[number][0],
  piiColumn: string,
): Promise<unknown> {
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const controller = new LinelistExportController(
    {
      [handler]: vi.fn().mockResolvedValue(exportResult(piiColumn)),
    } as unknown as LinelistExportService,
    audit as unknown as ConstructorParameters<
      typeof LinelistExportController
    >[1],
  );

  await controller[handler](
    linelistExportQuerySchema.parse({ period: '21d' }),
    GRANTED,
    responseDouble() as never,
  );

  expect(audit.record).toHaveBeenCalledTimes(1);
  return (audit.record.mock.calls[0][0] as Record<string, unknown>).dataset;
}

async function deniedDataset(
  method: (typeof DATASETS)[number][0],
  piiColumn: string,
): Promise<unknown> {
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const db = {
    query: vi.fn((sql: string) =>
      sql.includes('count(*)::text')
        ? Promise.resolve({ rows: [{ count: '0' }], rowCount: 1 })
        : Promise.resolve({ rows: [], rowCount: 0 }),
    ),
  } as unknown as Queryable;
  const service = new LinelistService(
    db,
    audit as unknown as ConstructorParameters<typeof LinelistService>[1],
  );

  await service[method](linelistQuerySchema.parse({ fields: piiColumn }), DENIED);

  expect(audit.record).toHaveBeenCalledTimes(1);
  return (audit.record.mock.calls[0][0] as Record<string, unknown>).dataset;
}

describe('audit dataset vocabulary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function silenceLogger() {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  }

  it.each(DATASETS)(
    '%s files pii_export and pii_column_denied under the same dataset',
    async (handler, piiColumn) => {
      silenceLogger();

      const [exported, denied] = await Promise.all([
        exportedDataset(handler, piiColumn),
        deniedDataset(handler, piiColumn),
      ]);

      expect(exported).toBe(denied);
    },
  );

  it('records the registry name, so a governance query finds both event types', async () => {
    silenceLogger();

    const recorded = await Promise.all(
      DATASETS.map(([handler, piiColumn]) => exportedDataset(handler, piiColumn)),
    );

    expect(recorded).toEqual([
      'lab_result',
      'screening',
      'case_investigation',
      'treatment_outcome',
      'contact_registration',
      'community_signal',
    ]);
  });

  it('never files an export under the url slug', async () => {
    silenceLogger();

    const recorded = await Promise.all(
      DATASETS.map(([handler, piiColumn]) => exportedDataset(handler, piiColumn)),
    );

    for (const slug of [
      'lab-results',
      'screenings',
      'cases',
      'outcomes',
      'contacts',
      'signals',
    ]) {
      expect(recorded).not.toContain(slug);
    }
  });
});
