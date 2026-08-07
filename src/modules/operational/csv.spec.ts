import { describe, expect, it } from 'vitest';

import { csvCell, csvRow } from './csv.js';
import { linelistExportQuerySchema } from './dto/linelist-export-query.dto.js';
import { linelistQuerySchema } from './dto/linelist-query.dto.js';

describe('CSV cells', () => {
  it.each([
    [null, ''],
    [undefined, ''],
    ['plain', 'plain'],
    [42, '42'],
    [true, 'true'],
    [new Date('2026-08-05T12:34:56.000Z'), '2026-08-05T12:34:56.000Z'],
  ])('serialises %j', (value, expected) => {
    expect(csvCell(value)).toBe(expected);
  });

  it.each([
    ['with,comma', '"with,comma"'],
    ['with "quote"', '"with ""quote"""'],
    ['with\rreturn', '"with\rreturn"'],
    ['with\nnewline', '"with\nnewline"'],
  ])('applies RFC 4180 quoting to %j', (value, expected) => {
    expect(csvCell(value)).toBe(expected);
  });

  it.each([
    ['=SUM(A1:A2)', "'=SUM(A1:A2)"],
    ['+1', "'+1"],
    ['-1', "'-1"],
    ['@name', "'@name"],
    ['\tformula', "'\tformula"],
    ['\rformula', '"\'\rformula"'],
  ])('neutralises the formula lead in %j', (value, expected) => {
    expect(csvCell(value)).toBe(expected);
  });

  it('neutralises a negative number after stringification', () => {
    expect(csvCell(-42)).toBe("'-42");
  });

  it('neutralises before quoting', () => {
    expect(csvCell('=SUM(A1,A2)')).toBe('"\'=SUM(A1,A2)"');
  });
});

describe('CSV rows', () => {
  it('joins cells with commas and terminates with CRLF', () => {
    expect(csvRow(['one', 'two'])).toBe('one,two\r\n');
    expect(csvRow([])).toBe('\r\n');
  });

  it('serialises every escape class in one row', () => {
    expect(csvRow(['plain', 'a,b', 'a"b', 'a\rb', 'a\nb', '=1'])).toBe(
      'plain,"a,b","a""b","a\rb","a\nb",\'=1\r\n',
    );
  });
});

describe('linelist export query contract', () => {
  it('leaves the shipped read paging and projection behaviour unchanged', () => {
    expect(linelistQuerySchema.parse({})).toEqual(
      expect.objectContaining({ page: 1, limit: 50, sortDir: 'desc' }),
    );
    expect(() => linelistQuerySchema.parse({ limit: '201' })).toThrow();
    expect(() => linelistQuerySchema.parse({ q: 'x'.repeat(201) })).toThrow();
    expect(() => linelistQuerySchema.parse({ fields: 'x'.repeat(1001) })).toThrow();
    expect(
      linelistQuerySchema.parse({ fields: ' one, two ,, ', q: '' }),
    ).toEqual(
      expect.objectContaining({ fields: ['one', 'two'], q: undefined }),
    );
  });

  it('composes the read projection contract without accepting paging', () => {
    const parsed = linelistExportQuerySchema.parse({
      page: '3',
      limit: '200',
      pageSize: '200',
      q: '',
      sortBy: '',
      fields: 'one, two',
    });

    expect(parsed).toEqual(
      expect.objectContaining({
        q: undefined,
        sortBy: undefined,
        sortDir: 'desc',
        fields: ['one', 'two'],
      }),
    );
    expect(parsed).not.toHaveProperty('page');
    expect(parsed).not.toHaveProperty('limit');
    expect(parsed).not.toHaveProperty('pageSize');
  });

  it('inherits projection bounds', () => {
    expect(() => linelistExportQuerySchema.parse({ q: 'x'.repeat(201) })).toThrow();
    expect(() =>
      linelistExportQuerySchema.parse({ fields: 'x'.repeat(1001) }),
    ).toThrow();
  });

  it('inherits all operational filters and the custom-range refinement', () => {
    const parsed = linelistExportQuerySchema.parse({
      period: 'custom',
      from: '2026-07-01',
      to: '2026-07-28',
      lab: 'KEMRI',
      poe: 'JKIA',
      ageGroup: '20-29',
      signalStatus: 'Verified',
      signalType: 'Death',
      communitySource: 'eCHIS',
      classification: 'Confirmed',
      resultStatus: 'Positive',
      specimenType: 'Blood',
      testName: 'PCR',
      turnaroundBand: '0-1 days',
      screeningOutcome: 'Cleared',
      screeningCategory: 'Arrival',
      treatmentOutcome: 'Recovered',
    });

    expect(parsed.from).toBe('2026-07-01 00:00:00');
    expect(parsed.to).toBe('2026-07-28 23:59:59.999');
    expect(parsed.treatmentOutcome).toBe('Recovered');
    expect(() =>
      linelistExportQuerySchema.parse({
        period: 'custom',
        from: '2026-07-28',
        to: '2026-07-01',
      }),
    ).toThrow();
  });
});
