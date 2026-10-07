import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { Pool } from 'pg';
import { newDb } from 'pg-mem';

import { DatabaseService } from '../database/database.module.js';
import { AuditService } from '../modules/audit/audit.service.js';
import {
  HEADLINE_FIGURE_FIELDS,
  HEADLINE_OVERRIDE_EVENT,
  type HeadlineFigures,
  HeadlineOverrideRow,
} from '../modules/reconciliation/headline-override.schema.js';
import { HeadlineOverrideService } from '../modules/reconciliation/headline-override.service.js';
import {
  HEADLINE_SEED_ROWS,
  seedHeadlineOverrides,
} from './seed-headline-overrides.js';

const SITUATION_DATES = [
  '2026-09-27',
  '2026-09-28',
  '2026-09-29',
  '2026-09-30',
  '2026-10-01',
  '2026-10-02',
  '2026-10-03',
  '2026-10-04',
  '2026-10-06',
];

type Figure = number | null;
type OfficialRow = readonly [string, string, ...Figure[]];

// situation date, report date, then the figures in HEADLINE_FIGURE_FIELDS order
// prettier-ignore
const OFFICIAL_ROWS: readonly OfficialRow[] = [
  ['2026-09-27', '2026-09-28', 0, 0, null, null, 253, 0, 0, 253, 627852, 3673, 15, null],
  ['2026-09-28', '2026-09-29', 0, 0, null, null, 257, 4, 0, 257, 631605, 3753, 15, null],
  ['2026-09-29', '2026-09-30', 0, 0, null, null, 257, 0, 0, 257, 635526, 3921, 15, null],
  ['2026-09-30', '2026-10-01', 0, 0, null, null, 263, 6, 0, 263, 638913, 3387, 15, null],
  ['2026-10-01', '2026-10-02', 0, 0, null, null, 263, 0, 0, 263, 642369, 3456, 15, null],
  ['2026-10-02', '2026-10-03', 0, 0, null, null, 265, 2, 0, 265, 645217, 2848, 15, null],
  ['2026-10-03', '2026-10-04', 0, 0, null, null, 265, 0, 0, 265, 648771, 3554, 15, null],
  ['2026-10-04', '2026-10-05', 0, 0, null, null, 266, 1, 0, 266, 652584, 3813, 15, null],
  ['2026-10-06', '2026-10-06', 1, 1, 0, 1, 267, null, 1, 266, 652584, null, null, 28],
];

const STAFF = { actorId: 'acct-recon-1', actorRole: 'reconciliation' };

function figureTable(
  rows: ReadonlyArray<
    {
      situation_date: string;
      report_date?: string | null;
    } & Partial<HeadlineFigures>
  >,
): unknown[][] {
  return rows.map((row) => [
    row.situation_date,
    row.report_date,
    ...HEADLINE_FIGURE_FIELDS.map((field) => row[field]),
  ]);
}

describe('seed-headline-overrides script', () => {
  let pool: Pool;
  let db: DatabaseService;
  let service: HeadlineOverrideService;

  beforeAll(async () => {
    pool = new (newDb().adapters.createPg().Pool)();
    db = new DatabaseService(pool);
    await db.ensureSchema();
    service = new HeadlineOverrideService(db, new AuditService(pool));
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await db.query('DELETE FROM headline_overrides');
    await db.query('DELETE FROM audit_events');
  });

  async function storedRows(): Promise<HeadlineOverrideRow[]> {
    const read = await db.query<HeadlineOverrideRow>(
      'SELECT * FROM headline_overrides ORDER BY situation_date',
    );
    return read.rows;
  }

  async function stored(situationDate: string): Promise<HeadlineOverrideRow> {
    const row = await service.find(situationDate);
    expect(row).not.toBeNull();
    return row as HeadlineOverrideRow;
  }

  async function seedAuditRows() {
    const read = await db.query<{
      actorId: string | null;
      actorRole: string | null;
    }>(
      'SELECT "actorId", "actorRole" FROM audit_events WHERE "eventType" = $1 AND "actorRole" = $2',
      [HEADLINE_OVERRIDE_EVENT, 'seed'],
    );
    return read.rows;
  }

  it('declares the nine official situation dates, with no row for 2026-10-05', () => {
    expect(HEADLINE_SEED_ROWS).toHaveLength(9);
    expect(HEADLINE_SEED_ROWS.map((row) => row.situation_date)).toEqual(
      SITUATION_DATES,
    );
  });

  it('declares every figure exactly as the workbook and the press release report it', () => {
    expect(figureTable(HEADLINE_SEED_ROWS)).toEqual(OFFICIAL_ROWS);
  });

  it('names a source for every row', () => {
    const labels = HEADLINE_SEED_ROWS.map((row) => row.source_label);

    expect(labels.slice(0, 8)).toEqual(
      OFFICIAL_ROWS.slice(0, 8).map(([, reportDate]) => {
        const [year, month, day] = reportDate.split('-');
        return `Brief_BVD in DRC_Kenya's Preparedness_${day}-${month}-${year}.pdf`;
      }),
    );
    expect(labels[8]).toBe('CS press release 6 Oct 2026');
  });

  it('inserts the nine official rows on an empty table', async () => {
    await expect(seedHeadlineOverrides(service)).resolves.toEqual({
      inserted: 9,
      skipped: 0,
    });

    const rows = await storedRows();
    expect(rows.map((row) => row.situation_date)).toEqual(SITUATION_DATES);
  });

  it('inserts nothing on a second run and still leaves nine rows', async () => {
    await seedHeadlineOverrides(service);

    await expect(seedHeadlineOverrides(service)).resolves.toEqual({
      inserted: 0,
      skipped: 9,
    });
    expect(await storedRows()).toHaveLength(9);
  });

  it('inserts only the missing dates when a row already exists', async () => {
    await service.create({ situation_date: '2026-10-06', deaths: 3 }, STAFF);

    await expect(seedHeadlineOverrides(service)).resolves.toEqual({
      inserted: 8,
      skipped: 1,
    });
    expect(await storedRows()).toHaveLength(9);
    expect((await stored('2026-10-06')).deaths).toBe(3);
  });

  it('does not revert a row staff edited between runs', async () => {
    await seedHeadlineOverrides(service);
    await service.update('2026-10-06', { deaths: 2 }, STAFF);

    await seedHeadlineOverrides(service);

    const row = await stored('2026-10-06');
    expect(row.deaths).toBe(2);
    expect(row.updatedBy).toBe(STAFF.actorId);
  });

  it('stores a reported zero as 0 and a workbook blank as NULL for 2026-09-27', async () => {
    await seedHeadlineOverrides(service);

    const row = await stored('2026-09-27');
    expect(row.positive_samples).toBe(0);
    expect(row.contacts_listed).toBeNull();
    expect(row.recoveries).toBeNull();
    expect(row.deaths).toBeNull();
  });

  it('stores the 2026-10-06 press-release row and leaves its three unreported figures NULL', async () => {
    await seedHeadlineOverrides(service);

    expect(await stored('2026-10-06')).toMatchObject({
      report_date: '2026-10-06',
      source_label: 'CS press release 6 Oct 2026',
      confirmed_cases: 1,
      confirmed_cases_24h: 1,
      recoveries: 0,
      deaths: 1,
      samples_tested_total: 267,
      samples_tested_24h: null,
      positive_samples: 1,
      negative_samples: 266,
      travellers_screened_total: 652584,
      travellers_screened_24h: null,
      screening_points: null,
      contacts_listed: 28,
    });
  });

  it('stores every row exactly as declared', async () => {
    await seedHeadlineOverrides(service);

    expect(figureTable(await storedRows())).toEqual(OFFICIAL_ROWS);
  });

  it('writes one headline_override audit row per seeded date as the seed actor, and none on a re-run', async () => {
    await seedHeadlineOverrides(service);

    const first = await seedAuditRows();
    expect(first).toHaveLength(9);
    expect(first.every((row) => row.actorRole === 'seed')).toBe(true);
    expect(first.every((row) => row.actorId === null)).toBe(true);

    await seedHeadlineOverrides(service);

    expect(await seedAuditRows()).toHaveLength(9);
  });

  it('writes only through the service, as the seed actor with no actor id', async () => {
    const find = vi
      .fn<HeadlineOverrideService['find']>()
      .mockResolvedValue(null);
    const create = vi
      .fn<HeadlineOverrideService['create']>()
      .mockResolvedValue(new HeadlineOverrideRow());

    await seedHeadlineOverrides({ find, create });

    expect(find.mock.calls.map(([date]) => date)).toEqual(SITUATION_DATES);
    expect(create.mock.calls.map(([row]) => row)).toEqual(HEADLINE_SEED_ROWS);
    expect(create.mock.calls.map(([, actor]) => actor)).toEqual(
      SITUATION_DATES.map(() => ({ actorId: null, actorRole: 'seed' })),
    );
  });
});
