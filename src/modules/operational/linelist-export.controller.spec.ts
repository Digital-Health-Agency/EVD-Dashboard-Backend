import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';

import { AUDIT_OUTCOMES } from '../audit/audit-event.schema.js';
import { linelistExportQuerySchema } from './dto/linelist-export-query.dto.js';
import {
  exportFilename,
  LinelistExportController,
} from './linelist-export.controller.js';
import type {
  LinelistExportResult,
  LinelistExportService,
} from './linelist-export.service.js';

const PUBLIC_ROUTE_KEY = 'PUBLIC';
const handlers = [
  'labResults',
  'screenings',
  'cases',
  'outcomes',
  'contacts',
  'signals',
] as const;

function result(
  rows: Record<string, unknown>[] = [],
  piiColumns: string[] = [],
): LinelistExportResult {
  return {
    columns: [
      { name: 'name', label: 'Person name', sortable: false, format: 'text' },
      { name: 'status', label: 'Status', sortable: true, format: 'status' },
    ],
    piiColumns,
    window: { from: '2026-07-07', to: '2026-07-28' },
    rows: (async function* () {
      yield* rows;
    })(),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function responseHarness(destroyAfterWrites = Number.POSITIVE_INFINITY) {
  const calls: Array<[string, ...unknown[]]> = [];
  let writes = 0;
  const response = {
    headersSent: false,
    destroyed: false,
    setHeader: vi.fn((name: string, value: string) => {
      calls.push(['header', name, value]);
    }),
    write: vi.fn((value: string) => {
      response.headersSent = true;
      calls.push(['write', value]);
      writes += 1;
      if (writes >= destroyAfterWrites) response.destroyed = true;
      return true;
    }),
    end: vi.fn(() => {
      calls.push(['end']);
    }),
    destroy: vi.fn((error?: Error) => {
      response.destroyed = true;
      calls.push(['destroy', error]);
    }),
    once: vi.fn(),
    off: vi.fn(),
  };
  return { response, calls };
}

function auditDouble() {
  return { record: vi.fn().mockResolvedValue(undefined) };
}

function makeController(
  stub: Record<string, unknown>,
  audit: { record: ReturnType<typeof vi.fn> } = auditDouble(),
) {
  const controller = new LinelistExportController(
    stub as unknown as LinelistExportService,
    audit as unknown as ConstructorParameters<
      typeof LinelistExportController
    >[1],
  );
  return { controller, audit };
}

function auditedEvent(audit: { record: ReturnType<typeof vi.fn> }) {
  expect(audit.record).toHaveBeenCalledTimes(1);
  return audit.record.mock.calls[0][0] as Record<string, unknown>;
}

describe('LinelistExportController route boundary', () => {
  it('carries no public-route metadata on the class or six handlers', () => {
    expect(
      Reflect.getMetadata(PUBLIC_ROUTE_KEY, LinelistExportController),
    ).toBeUndefined();
    for (const handler of handlers) {
      expect(
        Reflect.getMetadata(
          PUBLIC_ROUTE_KEY,
          LinelistExportController.prototype[handler],
        ),
      ).toBeUndefined();
    }
  });

  it('exposes exactly six literal handlers', () => {
    expect(
      Object.getOwnPropertyNames(LinelistExportController.prototype)
        .filter((name) => name !== 'constructor')
        .sort(),
    ).toEqual([...handlers].sort());
  });

  it.each(handlers)(
    '%s forwards the validated query with the shared principal-derived access',
    async (handler) => {
      const payload = result();
      const method = vi.fn().mockResolvedValue(payload);
      const { controller } = makeController({ [handler]: method });
      const query = linelistExportQuerySchema.parse({ period: '21d' });
      const { response } = responseHarness();

      await controller[handler](
        query,
        { user: { id: 'u-1', role: 'admin,surveillance' } },
        response as never,
      );

      expect(method).toHaveBeenCalledWith(query, {
        userId: 'u-1',
        role: 'admin,surveillance',
        allowPii: true,
      });
    },
  );

  it.each(handlers)(
    '%s forwards allowPii false for an admin caller without the surveillance role',
    async (handler) => {
      const payload = result();
      const method = vi.fn().mockResolvedValue(payload);
      const { controller } = makeController({ [handler]: method });
      const query = linelistExportQuerySchema.parse({ period: '21d' });
      const { response } = responseHarness();

      await controller[handler](
        query,
        { user: { id: 'u-1', role: 'admin' } },
        response as never,
      );

      expect(method).toHaveBeenCalledWith(query, {
        userId: 'u-1',
        role: 'admin',
        allowPii: false,
      });
    },
  );

  it('writes headers, label row, data rows and end in order', async () => {
    const { controller } = makeController({
      screenings: vi.fn().mockResolvedValue(
        result([
          { name: '=SUM(A1,A2)', status: 'Open' },
          { name: 'Amina', status: null },
        ]),
      ),
    });
    const { response, calls } = responseHarness();

    await controller.screenings(
      linelistExportQuerySchema.parse({}),
      { user: { id: 'u-1' } },
      response as never,
    );

    expect(calls).toEqual([
      ['header', 'Content-Type', 'text/csv; charset=utf-8'],
      [
        'header',
        'Content-Disposition',
        expect.stringMatching(
          /^attachment; filename="evd-screenings_2026-07-07_to_2026-07-28_exported-\d{4}-\d{2}-\d{2}_by-u-1\.csv"$/,
        ),
      ],
      ['header', 'Cache-Control', 'no-store'],
      ['write', 'Person name,Status\r\n'],
      ['write', '"\'=SUM(A1,A2)",Open\r\n'],
      ['write', 'Amina,\r\n'],
      ['end'],
    ]);
  });

  it('writes nothing when the service rejects before streaming', async () => {
    const { controller } = makeController({
      screenings: vi.fn().mockRejectedValue(new Error('warehouse unavailable')),
    });
    const { response, calls } = responseHarness();

    await expect(
      controller.screenings(
        linelistExportQuerySchema.parse({}),
        { user: { id: 'u-1' } },
        response as never,
      ),
    ).rejects.toThrow('warehouse unavailable');
    expect(calls).toEqual([]);
  });

  it('aborts without end when a cursor fails after bytes begin', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const payload: LinelistExportResult = {
      ...result(),
      rows: (async function* () {
        yield { name: 'Amina', status: 'Open' };
        throw new Error('cursor lost');
      })(),
      close,
    };
    const { controller } = makeController({
      screenings: vi.fn().mockResolvedValue(payload),
    });
    const { response, calls } = responseHarness();

    await controller.screenings(
      linelistExportQuerySchema.parse({}),
      { user: { id: 'u-1' } },
      response as never,
    );

    expect(calls.some(([kind]) => kind === 'destroy')).toBe(true);
    expect(calls.some(([kind]) => kind === 'end')).toBe(false);
    expect(close).toHaveBeenCalledOnce();
  });

  it('writes nothing and refuses before service access without a principal', async () => {
    const method = vi.fn();
    const { controller } = makeController({ screenings: method });
    const { response, calls } = responseHarness();

    await expect(
      controller.screenings(
        linelistExportQuerySchema.parse({}),
        {},
        response as never,
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(method).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
});

describe('LinelistExportController pii_export audit', () => {
  const PRINCIPAL = { user: { id: 'u-7', role: 'admin,surveillance' } };
  const ROWS = [
    { name: 'Amina', status: 'Open' },
    { name: 'Brenda', status: 'Closed' },
    { name: 'Chege', status: 'Open' },
  ];

  it('records exactly one pii_export event when the served projection carries pii', async () => {
    const { controller, audit } = makeController({
      screenings: vi.fn().mockResolvedValue(result(ROWS, ['name'])),
    });
    const { response } = responseHarness();

    await controller.screenings(
      linelistExportQuerySchema.parse({ period: '21d' }),
      PRINCIPAL,
      response as never,
    );

    const event = auditedEvent(audit);
    expect(event.eventType).toBe('pii_export');
    expect(event.outcome).toBe('ok');
    expect(event.actorId).toBe('u-7');
    expect(event.actorRole).toBe('admin,surveillance');
    expect(event.dataset).toBe('screening');
    expect(event.columns).toEqual(['name']);
  });

  it('counts the data rows written, excluding the header row', async () => {
    const { controller, audit } = makeController({
      screenings: vi.fn().mockResolvedValue(result(ROWS, ['name'])),
    });
    const { response, calls } = responseHarness();

    await controller.screenings(
      linelistExportQuerySchema.parse({}),
      PRINCIPAL,
      response as never,
    );

    const writes = calls.filter(([kind]) => kind === 'write');
    expect(writes).toHaveLength(ROWS.length + 1);
    expect(auditedEvent(audit).rowCount).toBe(ROWS.length);
  });

  it('carries the redacted filters, never the raw search term', async () => {
    const { controller, audit } = makeController({
      screenings: vi.fn().mockResolvedValue(result(ROWS, ['name'])),
    });
    const { response } = responseHarness();

    await controller.screenings(
      linelistExportQuerySchema.parse({ period: '21d', q: 'Wanjiku' }),
      PRINCIPAL,
      response as never,
    );

    const filters = auditedEvent(audit).filters as Record<string, unknown>;
    expect(filters.period).toBe('21d');
    expect(filters.q).toBeUndefined();
    expect(filters.qLength).toBe('Wanjiku'.length);
    expect(filters.qSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(filters)).not.toContain('Wanjiku');
  });

  it('records one aborted event with the partial count when the client goes away', async () => {
    const { controller, audit } = makeController({
      screenings: vi.fn().mockResolvedValue(result(ROWS, ['name'])),
    });
    const { response, calls } = responseHarness(3);

    await controller.screenings(
      linelistExportQuerySchema.parse({}),
      PRINCIPAL,
      response as never,
    );

    const event = auditedEvent(audit);
    expect(event.outcome).toBe('aborted');
    expect(event.rowCount).toBe(2);
    expect(calls.some(([kind]) => kind === 'end')).toBe(false);
    expect(AUDIT_OUTCOMES).toContain(event.outcome);
  });

  it('records one aborted event when the cursor fails after headers are sent', async () => {
    const payload: LinelistExportResult = {
      ...result([], ['name']),
      rows: (async function* () {
        yield { name: 'Amina', status: 'Open' };
        throw new Error('cursor lost');
      })(),
    };
    const { controller, audit } = makeController({
      screenings: vi.fn().mockResolvedValue(payload),
    });
    const { response } = responseHarness();

    await controller.screenings(
      linelistExportQuerySchema.parse({}),
      PRINCIPAL,
      response as never,
    );

    const event = auditedEvent(audit);
    expect(event.outcome).toBe('aborted');
    expect(event.rowCount).toBe(1);
  });

  it('records nothing when the served projection carries no pii column', async () => {
    const { controller, audit } = makeController({
      screenings: vi.fn().mockResolvedValue(result(ROWS, [])),
    });
    const { response, calls } = responseHarness();

    await controller.screenings(
      linelistExportQuerySchema.parse({}),
      PRINCIPAL,
      response as never,
    );

    expect(audit.record).not.toHaveBeenCalled();
    expect(calls.some(([kind]) => kind === 'end')).toBe(true);
  });

  it('records nothing when the service rejects before any byte is written', async () => {
    const { controller, audit } = makeController({
      screenings: vi.fn().mockRejectedValue(new Error('warehouse unavailable')),
    });
    const { response } = responseHarness();

    await expect(
      controller.screenings(
        linelistExportQuerySchema.parse({}),
        PRINCIPAL,
        response as never,
      ),
    ).rejects.toThrow('warehouse unavailable');
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('ends the response normally when the audit write rejects', async () => {
    const rejection = Promise.reject(new Error('audit sink unavailable'));
    rejection.catch(() => undefined);
    const { controller, audit } = makeController(
      { screenings: vi.fn().mockResolvedValue(result(ROWS, ['name'])) },
      { record: vi.fn(() => rejection) },
    );
    const { response, calls } = responseHarness();

    await controller.screenings(
      linelistExportQuerySchema.parse({}),
      PRINCIPAL,
      response as never,
    );

    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(calls.at(-1)).toEqual(['end']);
    expect(calls.some(([kind]) => kind === 'destroy')).toBe(false);
    for (const [kind, value] of calls) {
      if (kind === 'write') expect(String(value)).not.toContain('audit sink');
    }
  });

  it('writes the header row first, with no banner, comment or identity row above it', async () => {
    const { controller } = makeController({
      screenings: vi.fn().mockResolvedValue(result(ROWS, ['name'])),
    });
    const { response, calls } = responseHarness();

    await controller.screenings(
      linelistExportQuerySchema.parse({}),
      PRINCIPAL,
      response as never,
    );

    const written = calls
      .filter(([kind]) => kind === 'write')
      .map(([, value]) => String(value));
    expect(written[0]).toBe('Person name,Status\r\n');
    for (const chunk of written) {
      expect(chunk.startsWith('#')).toBe(false);
      expect(chunk).not.toContain('u-7');
    }
  });
});

describe('exportFilename', () => {
  const WINDOW = { from: '2026-07-07', to: '2026-07-28' };
  const EXPORTED_AT = new Date('2026-08-05T12:00:00Z');

  it('uses only an allowlisted dataset and validated ISO dates', () => {
    expect(exportFilename('signals', WINDOW, EXPORTED_AT, 'u-1')).toBe(
      'evd-signals_2026-07-07_to_2026-07-28_exported-2026-08-05_by-u-1.csv',
    );

    expect(() =>
      exportFilename(
        '../signals\r\nX-Evil: yes',
        WINDOW,
        EXPORTED_AT,
        'u-1',
      ),
    ).toThrow();
  });

  it.each([
    { from: '2026-02-30', to: '2026-07-28' },
    { from: '2026/07/07', to: '2026-07-28' },
    { from: '2026-07-07', to: '2026-07-28\r\nX-Evil: yes' },
  ])('rejects unsafe or impossible dates: %j', (window) => {
    expect(() =>
      exportFilename('cases', window, EXPORTED_AT, 'u-1'),
    ).toThrow();
  });

  it('rejects an invalid export date', () => {
    expect(() =>
      exportFilename('cases', WINDOW, new Date(Number.NaN), 'u-1'),
    ).toThrow();
  });

  it('appends the actor segment immediately before the csv extension', () => {
    expect(
      exportFilename('cases', WINDOW, EXPORTED_AT, 'abc123'),
    ).toMatch(/_by-abc123\.csv$/);
  });

  it('reduces an actor id to lowercase letters, digits and hyphens', () => {
    const filename = exportFilename(
      'cases',
      WINDOW,
      EXPORTED_AT,
      'A9F1-B2/../"Wanjiku"\r\n user@example.com',
    );
    const token = /_by-([^.]*)\.csv$/.exec(filename)?.[1];

    expect(token).toBeDefined();
    expect(token).toMatch(/^[a-z0-9-]+$/);
    expect(token).not.toContain('@');
    expect(filename).not.toMatch(/[\\/"\r\n@ ]/);
  });

  it('bounds the actor token in length', () => {
    const token = /_by-([^.]*)\.csv$/.exec(
      exportFilename('cases', WINDOW, EXPORTED_AT, 'a'.repeat(200)),
    )?.[1];

    expect(token?.length).toBeGreaterThan(0);
    expect(token?.length).toBeLessThanOrEqual(24);
  });

  it.each([undefined, null, '', '   ', '@@@', '../..'])(
    'falls back to the literal unknown token for %j',
    (actorId) => {
      expect(
        exportFilename('cases', WINDOW, EXPORTED_AT, actorId),
      ).toMatch(/_by-unknown\.csv$/);
    },
  );

  it('never emits a path separator, quote, CR or LF', () => {
    expect(
      exportFilename('lab-results', WINDOW, EXPORTED_AT, 'u-1'),
    ).not.toMatch(/[\\/"\r\n]/);
  });

  it('matches a conservative filename character class end to end', () => {
    expect(
      exportFilename('lab-results', WINDOW, EXPORTED_AT, 'U-1/../Evil'),
    ).toMatch(/^[a-z0-9._-]+$/);
  });
});
