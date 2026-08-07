const FORMULA_LEAD = /^[=+\-@\t\r]/;
const MUST_QUOTE = /[,"\r\n]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';

  const raw = value instanceof Date ? value.toISOString() : String(value);
  const guarded = FORMULA_LEAD.test(raw) ? `'${raw}` : raw;
  return MUST_QUOTE.test(guarded)
    ? `"${guarded.replaceAll('"', '""')}"`
    : guarded;
}

export function csvRow(values: readonly unknown[]): string {
  return `${values.map(csvCell).join(',')}\r\n`;
}
