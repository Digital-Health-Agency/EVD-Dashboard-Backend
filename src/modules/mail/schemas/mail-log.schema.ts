export class MailLog {
  id!: string;

  recipientEmail!: string;

  subject!: string;

  html?: string;

  text?: string;

  provider!: string;

  providerMessageId?: string;

  status!: 'pending' | 'sent' | 'delivered' | 'failed';

  deliveryStatus?: string;

  deliveredAt?: Date;

  error?: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export type MailLogDocument = MailLog;
