export interface SurveillanceEvent {
  key: string;
  label: string;
  startDate: string;
}

const EVD: SurveillanceEvent = Object.freeze({
  key: 'evd',
  label: 'Ebola Virus Disease',
  startDate: '2026-05-15',
});

export const SURVEILLANCE_START_DATE_ENV = 'SURVEILLANCE_START_DATE';

export const DEFAULT_SURVEILLANCE_START_DATE = EVD.startDate;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}

export function resolveSurveillanceStartDate(): string {
  const override = process.env[SURVEILLANCE_START_DATE_ENV];
  if (override === undefined || override.trim().length === 0) {
    return EVD.startDate;
  }

  const candidate = override.trim();
  if (!isCalendarDate(candidate)) {
    throw new Error(
      `${SURVEILLANCE_START_DATE_ENV} must be an ISO calendar date (YYYY-MM-DD), received ${JSON.stringify(override)}. ` +
        'Every data window is floored at this date, so an unusable value is refused at boot ' +
        'rather than ignored — a silently dropped cut-off looks exactly like no cut-off at all.',
    );
  }
  return candidate;
}

export function activeSurveillanceEvent(): SurveillanceEvent {
  return { ...EVD, startDate: resolveSurveillanceStartDate() };
}

export function surveillanceFloorPredicate(
  column: string,
  placeholder: string,
): string {
  return `${column} >= ${placeholder}::timestamptz`;
}

export function anchoredWindowLowerBound(
  column: string,
  anchoredExpression: string,
  placeholder: string,
): string {
  return (
    `${column} > ${anchoredExpression}` +
    ` AND ${column} >= ${placeholder}::timestamptz`
  );
}

export function clampToSurveillanceStart(value: string): string {
  const start = resolveSurveillanceStartDate();
  if (value.slice(0, 10) >= start) return value;
  return value.length > 10 ? `${start} 00:00:00` : start;
}
