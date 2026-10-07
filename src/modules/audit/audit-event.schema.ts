export const AUDIT_EVENT_TYPES = [
  'pii_export',
  'pii_column_denied',
  'headline_override',
] as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export const AUDIT_OUTCOMES = ['ok', 'denied', 'error', 'aborted'] as const;

export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

export class AuditEvent {
  id!: string;

  eventType!: string;

  actorId?: string;

  actorName?: string;

  actorRole?: string;

  dataset?: string;

  columns!: string[];

  filters!: Record<string, unknown>;

  rowCount?: number;

  outcome!: AuditOutcome;

  createdAt?: Date;
}

export type AuditEventDocument = AuditEvent;
