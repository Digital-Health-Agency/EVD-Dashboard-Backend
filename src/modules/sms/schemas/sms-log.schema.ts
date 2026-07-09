export class SmsLog {
  id!: string;

  recipientPhone!: string;

  message!: string;

  provider!: string;

  providerMessageId?: string;

  status!: 'pending' | 'sent' | 'delivered' | 'failed';

  deliveryStatus?: string; // From callback: Success, Failed, Rejected, Submitted, Buffered

  deliveredAt?: Date;

  error?: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export type SmsLogDocument = SmsLog;
