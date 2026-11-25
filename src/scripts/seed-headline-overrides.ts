import * as fs from 'node:fs';
import * as path from 'node:path';
import { Pool } from 'pg';
import { resolveAuthDatabaseUrl } from '../config/env.config.js';
import { DatabaseService } from '../database/database.module.js';
import { AuditService } from '../modules/audit/audit.service.js';
import {
  HeadlineOverrideService,
  type HeadlineOverrideCreateInput,
} from '../modules/reconciliation/headline-override.service.js';

const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

const SEED_ACTOR = { actorId: null, actorRole: 'seed' };

// Workbook "Kenya metrics" rows and the 6 Oct press release. null = not reported.
export const HEADLINE_SEED_ROWS: readonly HeadlineOverrideCreateInput[] = [
  {
    situation_date: '2026-09-27',
    report_date: '2026-09-28',
    confirmed_cases: 0,
    confirmed_cases_24h: 0,
    recoveries: null,
    deaths: null,
    samples_tested_total: 253,
    samples_tested_24h: 0,
    positive_samples: 0,
    negative_samples: 253,
    travellers_screened_total: 627852,
    travellers_screened_24h: 3673,
    screening_points: 15,
    contacts_listed: null,
    source_label: "Brief_BVD in DRC_Kenya's Preparedness_28-09-2026.pdf",
    notes: null,
  },
  {
    situation_date: '2026-09-28',
    report_date: '2026-09-29',
    confirmed_cases: 0,
    confirmed_cases_24h: 0,
    recoveries: null,
    deaths: null,
    samples_tested_total: 257,
    samples_tested_24h: 4,
    positive_samples: 0,
    negative_samples: 257,
    travellers_screened_total: 631605,
    travellers_screened_24h: 3753,
    screening_points: 15,
    contacts_listed: null,
    source_label: "Brief_BVD in DRC_Kenya's Preparedness_29-09-2026.pdf",
    notes: null,
  },
  {
    situation_date: '2026-09-29',
    report_date: '2026-09-30',
    confirmed_cases: 0,
    confirmed_cases_24h: 0,
    recoveries: null,
    deaths: null,
    samples_tested_total: 257,
    samples_tested_24h: 0,
    positive_samples: 0,
    negative_samples: 257,
    travellers_screened_total: 635526,
    travellers_screened_24h: 3921,
    screening_points: 15,
    contacts_listed: null,
    source_label: "Brief_BVD in DRC_Kenya's Preparedness_30-09-2026.pdf",
    notes: null,
  },
  {
    situation_date: '2026-09-30',
    report_date: '2026-10-01',
    confirmed_cases: 0,
    confirmed_cases_24h: 0,
    recoveries: null,
    deaths: null,
    samples_tested_total: 263,
    samples_tested_24h: 6,
    positive_samples: 0,
    negative_samples: 263,
    travellers_screened_total: 638913,
    travellers_screened_24h: 3387,
    screening_points: 15,
    contacts_listed: null,
    source_label: "Brief_BVD in DRC_Kenya's Preparedness_01-10-2026.pdf",
    notes: null,
  },
  {
    situation_date: '2026-10-01',
    report_date: '2026-10-02',
    confirmed_cases: 0,
    confirmed_cases_24h: 0,
    recoveries: null,
    deaths: null,
    samples_tested_total: 263,
    samples_tested_24h: 0,
    positive_samples: 0,
    negative_samples: 263,
    travellers_screened_total: 642369,
    travellers_screened_24h: 3456,
    screening_points: 15,
    contacts_listed: null,
    source_label: "Brief_BVD in DRC_Kenya's Preparedness_02-10-2026.pdf",
    notes: null,
  },
  {
    situation_date: '2026-10-02',
    report_date: '2026-10-03',
    confirmed_cases: 0,
    confirmed_cases_24h: 0,
    recoveries: null,
    deaths: null,
    samples_tested_total: 265,
    samples_tested_24h: 2,
    positive_samples: 0,
    negative_samples: 265,
    travellers_screened_total: 645217,
    travellers_screened_24h: 2848,
    screening_points: 15,
    contacts_listed: null,
    source_label: "Brief_BVD in DRC_Kenya's Preparedness_03-10-2026.pdf",
    notes: null,
  },
  {
    situation_date: '2026-10-03',
    report_date: '2026-10-04',
    confirmed_cases: 0,
    confirmed_cases_24h: 0,
    recoveries: null,
    deaths: null,
    samples_tested_total: 265,
    samples_tested_24h: 0,
    positive_samples: 0,
    negative_samples: 265,
    travellers_screened_total: 648771,
    travellers_screened_24h: 3554,
    screening_points: 15,
    contacts_listed: null,
    source_label: "Brief_BVD in DRC_Kenya's Preparedness_04-10-2026.pdf",
    notes: null,
  },
  {
    situation_date: '2026-10-04',
    report_date: '2026-10-05',
    confirmed_cases: 0,
    confirmed_cases_24h: 0,
    recoveries: null,
    deaths: null,
    samples_tested_total: 266,
    samples_tested_24h: 1,
    positive_samples: 0,
    negative_samples: 266,
    travellers_screened_total: 652584,
    travellers_screened_24h: 3813,
    screening_points: 15,
    contacts_listed: null,
    source_label: "Brief_BVD in DRC_Kenya's Preparedness_05-10-2026.pdf",
    notes: null,
  },
  {
    situation_date: '2026-10-06',
    report_date: '2026-10-06',
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
    source_label: 'CS press release 6 Oct 2026',
    notes:
      'The 23 passengers and 4 crew being pursued are not counted as listed contacts.',
  },
];

export async function seedHeadlineOverrides(
  service: Pick<HeadlineOverrideService, 'find' | 'create'>,
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;

  for (const row of HEADLINE_SEED_ROWS) {
    if (await service.find(row.situation_date)) {
      skipped += 1;
      continue;
    }
    await service.create(row, SEED_ACTOR);
    inserted += 1;
  }

  return { inserted, skipped };
}

async function main() {
  console.log('\n=== DHA EVD Headline Figures Seed ===\n');

  const pool = new Pool({ connectionString: resolveAuthDatabaseUrl() });

  try {
    const database = new DatabaseService(pool);
    await database.ensureSchema();
    const service = new HeadlineOverrideService(
      database,
      new AuditService(pool),
    );

    const result = await seedHeadlineOverrides(service);

    console.log(`✓ Rows inserted: ${result.inserted}`);
    console.log(`✓ Rows skipped (date already present): ${result.skipped}`);
    console.log('\nDone! Headline series seeded.\n');
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  void main();
}
