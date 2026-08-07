import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';

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
): LinelistExportResult {
  return {
    columns: [
      { name: 'name', label: 'Person name', sortable: false, format: 'text' },
      { name: 'status', label: 'Status', sortable: true, format: 'status' },
    ],
    window: { from: '2026-07-07', to: '2026-07-28' },
    rows: (async function* () {
      yield* rows;
    })(),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function responseHarness() {
  const calls: Array<[string, ...unknown[]]> = [];
  const response = {
    headersSent: false,
    destroyed: false,
    setHeader: vi.fn((name: string, value: string) => {
      calls.push(['header', name, value]);
    }),
    write: vi.fn((value: string) => {
      response.headersSent = true;
      calls.push(['write', value]);
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
      const controller = new LinelistExportController({
        [handler]: method,
      } as unknown as LinelistExportService);
      const query = linelistExportQuerySchema.parse({ period: '21d' });
      const { response } = responseHarness();

      await controller[handler](
        query,
        { user: { id: 'u-1', role: 'viewer' } },
        response as never,
      );

      expect(method).toHaveBeenCalledWith(query, {
        userId: 'u-1',
        role: 'viewer',
        allowPii: true,
      });
    },
  );

  it('writes headers, label row, data rows and end in order', async () => {
    const controller = new LinelistExportController({
      screenings: vi.fn().mockResolvedValue(
        result([
          { name: '=SUM(A1,A2)', status: 'Open' },
          { name: 'Amina', status: null },
        ]),
      ),
    } as unknown as LinelistExportService);
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
          /^attachment; filename="evd-screenings_2026-07-07_to_2026-07-28_exported-\d{4}-\d{2}-\d{2}\.csv"$/,
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
    const controller = new LinelistExportController({
      screenings: vi.fn().mockRejectedValue(new Error('warehouse unavailable')),
    } as unknown as LinelistExportService);
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
    const controller = new LinelistExportController({
      screenings: vi.fn().mockResolvedValue(payload),
    } as unknown as LinelistExportService);
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
    const controller = new LinelistExportController({
      screenings: method,
    } as unknown as LinelistExportService);
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

describe('exportFilename', () => {
  it('uses only an allowlisted dataset and validated ISO dates', () => {
    expect(
      exportFilename(
        'signals',
        { from: '2026-07-07', to: '2026-07-28' },
        new Date('2026-08-05T12:00:00Z'),
      ),
    ).toBe('evd-signals_2026-07-07_to_2026-07-28_exported-2026-08-05.csv');

    expect(() =>
      exportFilename(
        '../signals\r\nX-Evil: yes',
        { from: '2026-07-07', to: '2026-07-28' },
        new Date('2026-08-05T12:00:00Z'),
      ),
    ).toThrow();
  });

  it.each([
    { from: '2026-02-30', to: '2026-07-28' },
    { from: '2026/07/07', to: '2026-07-28' },
    { from: '2026-07-07', to: '2026-07-28\r\nX-Evil: yes' },
  ])('rejects unsafe or impossible dates: %j', (window) => {
    expect(() =>
      exportFilename('cases', window, new Date('2026-08-05T12:00:00Z')),
    ).toThrow();
  });

  it('never emits a path separator, quote, CR or LF', () => {
    expect(
      exportFilename(
        'lab-results',
        { from: '2026-07-07', to: '2026-07-28' },
        new Date('2026-08-05T12:00:00Z'),
      ),
    ).not.toMatch(/[\\/"\r\n]/);
  });
});
