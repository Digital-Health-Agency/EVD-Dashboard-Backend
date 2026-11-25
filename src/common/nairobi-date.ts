const NAIROBI_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Nairobi',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function nairobiToday(now: Date = new Date()): string {
  return NAIROBI_DATE.format(now);
}
