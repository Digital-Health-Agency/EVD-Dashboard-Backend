import { afterEach, describe, expect, it, vi } from 'vitest';

import { HEADLINE_FIGURE_FIELDS } from '../headline-override.schema.js';
import type {
  HeadlineOverrideCreateInput,
  HeadlineOverrideUpdateInput,
} from '../headline-override.service.js';
import {
  createHeadlineOverrideSchema,
  dateOnlySchema,
  figureSchema,
  newSituationDateSchema,
  situationDateParamSchema,
  updateHeadlineOverrideSchema,
  type CreateHeadlineOverrideDto,
  type UpdateHeadlineOverrideDto,
} from './headline-override.dto.js';

const SITUATION_DATE = '2026-10-06';

describe('dateOnlySchema', () => {
  it('accepts a real calendar date written YYYY-MM-DD', () => {
    expect(dateOnlySchema.parse(SITUATION_DATE)).toBe(SITUATION_DATE);
  });

  it('trims surrounding whitespace', () => {
    expect(dateOnlySchema.parse(` ${SITUATION_DATE} `)).toBe(SITUATION_DATE);
  });

  it.each([
    '2026-10-6',
    '06/10/2026',
    '2026-13-01',
    '2026-02-30',
    '2026-10-06T00:00:00Z',
    '',
    'not-a-date',
  ])('rejects %j', (value) => {
    expect(dateOnlySchema.safeParse(value).success).toBe(false);
  });

  it.each([20261006, null, undefined])('rejects the non-string %j', (value) => {
    expect(dateOnlySchema.safeParse(value).success).toBe(false);
  });
});

describe('situationDateParamSchema', () => {
  it('is the date-only schema', () => {
    expect(situationDateParamSchema).toBe(dateOnlySchema);
  });

  it('still addresses a row keyed in the future, so it can be cleared', () => {
    expect(situationDateParamSchema.parse('2099-01-01')).toBe('2099-01-01');
  });
});

describe('newSituationDateSchema', () => {
  const FUTURE = 'Situation date cannot be in the future';

  function at(instant: string) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(instant));
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(['2026-10-07', '2026-10-06', '2026-09-27', '2020-01-01'])(
    'accepts %s when today in Nairobi is 2026-10-07',
    (value) => {
      at('2026-10-07T05:00:00Z');

      expect(newSituationDateSchema.parse(value)).toBe(value);
    },
  );

  it.each(['2026-10-08', '2026-12-25', '2027-10-06', '9999-12-31'])(
    'rejects %s when today in Nairobi is 2026-10-07',
    (value) => {
      at('2026-10-07T05:00:00Z');

      const parsed = newSituationDateSchema.safeParse(value);

      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.map((issue) => issue.message)).toEqual([
        FUTURE,
      ]);
    },
  );

  it('turns over at midnight in Nairobi, not at midnight UTC', () => {
    at('2026-10-06T20:59:59Z');
    expect(newSituationDateSchema.safeParse('2026-10-07').success).toBe(false);

    at('2026-10-06T21:00:00Z');
    expect(newSituationDateSchema.safeParse('2026-10-07').success).toBe(true);
  });

  it('sets no lower bound, so history can still be entered', () => {
    expect(newSituationDateSchema.safeParse('2014-03-23').success).toBe(true);
    expect(newSituationDateSchema.safeParse('0001-01-01').success).toBe(true);
  });

  it.each(['2026-13-01', '9999-02-30', 'not-a-date', ''])(
    'reports %j as a bad date, not as a future one',
    (value) => {
      const parsed = newSituationDateSchema.safeParse(value);

      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.map((issue) => issue.message)).not.toContain(
        FUTURE,
      );
    },
  );
});

describe('figureSchema', () => {
  it.each([0, 1, 652584, null])('accepts %j', (value) => {
    const parsed = figureSchema.safeParse(value);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toBe(value);
  });

  it.each([-1, 1.5, '1', '', undefined])('rejects %j', (value) => {
    expect(figureSchema.safeParse(value).success).toBe(false);
  });

  it.each([Number.NaN, Infinity])('rejects the non-finite %s', (value) => {
    expect(figureSchema.safeParse(value).success).toBe(false);
  });

  it('stops at the largest value the integer column can hold', () => {
    expect(figureSchema.safeParse(2147483647).success).toBe(true);
    expect(figureSchema.safeParse(2147483648).success).toBe(false);
  });
});

describe('createHeadlineOverrideSchema', () => {
  it('keeps only the keys that were sent', () => {
    const parsed = createHeadlineOverrideSchema.parse({
      situation_date: SITUATION_DATE,
      deaths: 1,
    }) as Record<string, unknown>;

    expect(parsed).toStrictEqual({ situation_date: SITUATION_DATE, deaths: 1 });
    expect(Object.keys(parsed).sort()).toEqual(['deaths', 'situation_date']);
  });

  it('rejects a body without a situation date', () => {
    expect(createHeadlineOverrideSchema.safeParse({ deaths: 1 }).success).toBe(
      false,
    );
  });

  it('rejects a situation date that is not a real calendar date', () => {
    expect(
      createHeadlineOverrideSchema.safeParse({ situation_date: '2026-02-30' })
        .success,
    ).toBe(false);
  });

  it('rejects a situation date after today in Nairobi and names the field', () => {
    const parsed = createHeadlineOverrideSchema.safeParse({
      situation_date: '2099-01-01',
      deaths: 0,
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues).toHaveLength(1);
    expect(parsed.error?.issues[0]).toMatchObject({
      path: ['situation_date'],
      message: 'Situation date cannot be in the future',
    });
  });

  it('does not bound the report date, which follows the situation date', () => {
    expect(
      createHeadlineOverrideSchema.safeParse({
        situation_date: SITUATION_DATE,
        report_date: '2099-01-01',
      }).success,
    ).toBe(true);
  });

  it('rejects a report date that is not a real calendar date', () => {
    expect(
      createHeadlineOverrideSchema.safeParse({
        situation_date: SITUATION_DATE,
        report_date: '2026-13-01',
      }).success,
    ).toBe(false);
  });

  it('rejects a negative figure', () => {
    expect(
      createHeadlineOverrideSchema.safeParse({
        situation_date: SITUATION_DATE,
        deaths: -1,
      }).success,
    ).toBe(false);
  });

  it('rejects a fractional figure', () => {
    expect(
      createHeadlineOverrideSchema.safeParse({
        situation_date: SITUATION_DATE,
        deaths: 1.5,
      }).success,
    ).toBe(false);
  });

  it('rejects a figure sent as a string', () => {
    expect(
      createHeadlineOverrideSchema.safeParse({
        situation_date: SITUATION_DATE,
        deaths: '1',
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown key, so a fatality rate can never be stored', () => {
    expect(
      createHeadlineOverrideSchema.safeParse({
        situation_date: SITUATION_DATE,
        case_fatality_rate: 50,
      }).success,
    ).toBe(false);
  });

  it('keeps a zero as zero', () => {
    const parsed = createHeadlineOverrideSchema.safeParse({
      situation_date: SITUATION_DATE,
      positive_samples: 0,
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data).toStrictEqual({
      situation_date: SITUATION_DATE,
      positive_samples: 0,
    });
  });

  it('keeps a blank as null, never zero', () => {
    const parsed = createHeadlineOverrideSchema.safeParse({
      situation_date: SITUATION_DATE,
      positive_samples: null,
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data).toStrictEqual({
      situation_date: SITUATION_DATE,
      positive_samples: null,
    });
  });

  it.each(HEADLINE_FIGURE_FIELDS)(
    'validates %s as a non-negative integer or null',
    (field) => {
      const body = (value: unknown) => ({
        situation_date: SITUATION_DATE,
        [field]: value,
      });

      expect(createHeadlineOverrideSchema.safeParse(body(7)).success).toBe(
        true,
      );
      expect(createHeadlineOverrideSchema.safeParse(body(null)).success).toBe(
        true,
      );
      expect(createHeadlineOverrideSchema.safeParse(body(-7)).success).toBe(
        false,
      );
      expect(createHeadlineOverrideSchema.safeParse(body(0.5)).success).toBe(
        false,
      );
    },
  );

  it('trims the source label and the notes', () => {
    const parsed = createHeadlineOverrideSchema.parse({
      situation_date: SITUATION_DATE,
      source_label: '  CS press release 6 Oct 2026 ',
      notes: ' imported case ',
    });

    expect(parsed).toStrictEqual({
      situation_date: SITUATION_DATE,
      source_label: 'CS press release 6 Oct 2026',
      notes: 'imported case',
    });
  });

  it('accepts null for the report date, the source label and the notes', () => {
    const body = {
      situation_date: SITUATION_DATE,
      report_date: null,
      source_label: null,
      notes: null,
    };

    expect(createHeadlineOverrideSchema.parse(body)).toStrictEqual(body);
  });

  it('accepts a source label of 200 characters and rejects 201', () => {
    const body = (length: number) => ({
      situation_date: SITUATION_DATE,
      source_label: 'x'.repeat(length),
    });

    expect(createHeadlineOverrideSchema.safeParse(body(200)).success).toBe(
      true,
    );
    expect(createHeadlineOverrideSchema.safeParse(body(201)).success).toBe(
      false,
    );
  });

  it('accepts notes of 1000 characters and rejects 1001', () => {
    const body = (length: number) => ({
      situation_date: SITUATION_DATE,
      notes: 'x'.repeat(length),
    });

    expect(createHeadlineOverrideSchema.safeParse(body(1000)).success).toBe(
      true,
    );
    expect(createHeadlineOverrideSchema.safeParse(body(1001)).success).toBe(
      false,
    );
  });
});

describe('updateHeadlineOverrideSchema', () => {
  it('rejects a body that tries to move the row to another date', () => {
    expect(
      updateHeadlineOverrideSchema.safeParse({
        situation_date: SITUATION_DATE,
        deaths: 2,
      }).success,
    ).toBe(false);
  });

  it('keeps exactly the keys that were sent, a clear included', () => {
    const parsed = updateHeadlineOverrideSchema.parse({
      expected_revision: 1,
      expected_record_id: 'test-record',
      recoveries: null,
      deaths: 2,
    }) as Record<string, unknown>;

    expect(parsed).toStrictEqual({
      expected_revision: 1,
      expected_record_id: 'test-record',
      recoveries: null,
      deaths: 2,
    });
    expect(Object.keys(parsed).sort()).toEqual([
      'deaths',
      'expected_record_id',
      'expected_revision',
      'recoveries',
    ]);
  });

  it('accepts a revision-only body', () => {
    expect(
      updateHeadlineOverrideSchema.parse({
        expected_revision: 1,
        expected_record_id: 'test-record',
      }),
    ).toStrictEqual({
      expected_revision: 1,
      expected_record_id: 'test-record',
    });
  });

  it('rejects an unknown key', () => {
    expect(
      updateHeadlineOverrideSchema.safeParse({ case_fatality_rate: 50 })
        .success,
    ).toBe(false);
  });

  it('rejects a negative figure', () => {
    expect(updateHeadlineOverrideSchema.safeParse({ deaths: -1 }).success).toBe(
      false,
    );
  });
});

describe('service input contract', () => {
  it('parses into the shapes the service accepts', () => {
    const created: CreateHeadlineOverrideDto =
      createHeadlineOverrideSchema.parse({
        situation_date: SITUATION_DATE,
        deaths: 1,
      });
    const createInput: HeadlineOverrideCreateInput = created;

    const updated: UpdateHeadlineOverrideDto =
      updateHeadlineOverrideSchema.parse({
        expected_revision: 1,
        expected_record_id: 'test-record',
        deaths: 2,
      });
    const updateInput: HeadlineOverrideUpdateInput = updated;

    expect(createInput.situation_date).toBe(SITUATION_DATE);
    expect(updateInput.deaths).toBe(2);
  });
});

describe('optimistic update revision', () => {
  it('requires a positive integer revision for API updates', () => {
    for (const expected_revision of [undefined, null, 0, -1, 1.5, '1']) {
      expect(
        updateHeadlineOverrideSchema.safeParse({ deaths: 2, expected_revision })
          .success,
      ).toBe(false);
    }
    expect(
      updateHeadlineOverrideSchema.parse({
        deaths: 2,
        expected_revision: 1,
        expected_record_id: 'test-record',
      }),
    ).toEqual({
      deaths: 2,
      expected_revision: 1,
      expected_record_id: 'test-record',
    });
  });
});
