import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_SURVEILLANCE_START_DATE,
  SURVEILLANCE_START_DATE_ENV,
  activeSurveillanceEvent,
  clampToSurveillanceStart,
  anchoredWindowLowerBound,
  resolveSurveillanceStartDate,
  surveillanceFloorPredicate,
} from './surveillance-event.js';

describe('surveillance event', () => {
  let previous: string | undefined;

  beforeEach(() => {
    previous = process.env[SURVEILLANCE_START_DATE_ENV];
    delete process.env[SURVEILLANCE_START_DATE_ENV];
  });

  afterEach(() => {
    if (previous === undefined) {
      delete process.env[SURVEILLANCE_START_DATE_ENV];
    } else {
      process.env[SURVEILLANCE_START_DATE_ENV] = previous;
    }
  });

  describe('the active event', () => {
    it('is the EVD outbreak, starting on the agreed date', () => {
      expect(activeSurveillanceEvent()).toEqual({
        key: 'evd',
        label: 'Ebola Virus Disease',
        startDate: '2026-05-15',
      });
    });

    it('publishes that same date as the default', () => {
      expect(DEFAULT_SURVEILLANCE_START_DATE).toBe('2026-05-15');
      expect(resolveSurveillanceStartDate()).toBe('2026-05-15');
    });
  });

  describe('the environment override', () => {
    it('replaces the start date when it is a real calendar date', () => {
      process.env[SURVEILLANCE_START_DATE_ENV] = '2027-01-31';

      expect(resolveSurveillanceStartDate()).toBe('2027-01-31');
      expect(activeSurveillanceEvent().startDate).toBe('2027-01-31');
      expect(activeSurveillanceEvent().key).toBe('evd');
    });

    it('tolerates surrounding whitespace', () => {
      process.env[SURVEILLANCE_START_DATE_ENV] = '  2027-01-31  ';

      expect(resolveSurveillanceStartDate()).toBe('2027-01-31');
    });

    it('falls back to the default when unset or blank', () => {
      expect(resolveSurveillanceStartDate()).toBe('2026-05-15');

      process.env[SURVEILLANCE_START_DATE_ENV] = '   ';
      expect(resolveSurveillanceStartDate()).toBe('2026-05-15');
    });

    it.each([
      ['not-a-date'],
      ['2026-13-01'],
      ['2026-02-30'],
      ['2026-04-31'],
      ['15/05/2026'],
      ['2026-5-15'],
      ['2026-05-15T00:00:00Z'],
      ['0'],
    ])('refuses %s rather than silently ignoring it', (value) => {
      process.env[SURVEILLANCE_START_DATE_ENV] = value;

      expect(() => resolveSurveillanceStartDate()).toThrow(
        /SURVEILLANCE_START_DATE must be an ISO calendar date/,
      );
    });

    it('names the offending value in the failure so it can be corrected', () => {
      process.env[SURVEILLANCE_START_DATE_ENV] = '2026-02-30';

      expect(() => activeSurveillanceEvent()).toThrow(/2026-02-30/);
    });
  });

  describe('clampToSurveillanceStart', () => {
    it('raises a date-only bound that predates the start', () => {
      expect(clampToSurveillanceStart('2020-01-01')).toBe('2026-05-15');
    });

    it('raises a widened timestamp bound to the start of that day', () => {
      expect(clampToSurveillanceStart('2020-01-01 00:00:00')).toBe(
        '2026-05-15 00:00:00',
      );
    });

    it('leaves a bound on or after the start untouched', () => {
      expect(clampToSurveillanceStart('2026-05-15')).toBe('2026-05-15');
      expect(clampToSurveillanceStart('2026-07-01 00:00:00')).toBe(
        '2026-07-01 00:00:00',
      );
      expect(clampToSurveillanceStart('2026-05-15 06:30:00')).toBe(
        '2026-05-15 06:30:00',
      );
    });

    it('clamps against the override, not the built-in default', () => {
      process.env[SURVEILLANCE_START_DATE_ENV] = '2027-01-31';

      expect(clampToSurveillanceStart('2026-07-01 00:00:00')).toBe(
        '2027-01-31 00:00:00',
      );
    });
  });

  describe('SQL fragments', () => {
    it('floors an unanchored window at the bound placeholder', () => {
      expect(surveillanceFloorPredicate('event_at', '$2')).toBe(
        'event_at >= $2::timestamptz',
      );
    });

    it('raises an anchored lower bound without moving the anchor', () => {
      expect(
        anchoredWindowLowerBound(
          'event_at',
          "bounds.max_event_at - interval '42 days'",
          '$1',
        ),
      ).toBe(
        "event_at > bounds.max_event_at - interval '42 days'" +
          ' AND event_at >= $1::timestamptz',
      );
    });

    it('keeps the surveillance floor inclusive while the anchor stays exclusive', () => {
      const sql = anchoredWindowLowerBound(
        'event_at',
        "bounds.max_event_at - interval '42 days'",
        '$1',
      );
      expect(sql).not.toContain('greatest(');
      expect(sql).toContain('event_at >= $1::timestamptz');
      expect(surveillanceFloorPredicate('event_at', '$1')).toContain(
        'event_at >= $1',
      );
    });
  });
});
