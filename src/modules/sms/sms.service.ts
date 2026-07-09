import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import AfricasTalking from 'africastalking';
import { DatabaseService } from '../../database/database.module.js';

export interface SendSmsResult {
  providerMessageId?: string;
}

interface AfricasTalkingSms {
  send(params: { to: string[]; message: string; from?: string }): Promise<{
    SMSMessageData?: {
      Recipients?: Array<{ messageId?: string; status?: string }>;
    };
  }>;
}

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly provider: string;
  private readonly apiKey?: string;
  private readonly username?: string;
  private readonly senderId?: string;
  private readonly smsClient: AfricasTalkingSms | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly db: DatabaseService,
  ) {
    this.provider =
      this.configService.get<string>('SMS_PROVIDER') || 'africastalking';
    this.apiKey = this.configService.get<string>('SMS_API_KEY');
    this.username = this.configService.get<string>('SMS_USERNAME');
    this.senderId = this.configService.get<string>('SMS_SENDER_ID') || 'DHAEVD';

    if (this.provider === 'africastalking' && this.apiKey && this.username) {
      const client = AfricasTalking({
        apiKey: this.apiKey,
        username: this.username,
      });
      this.smsClient = client.SMS;
    }
  }

  /**
   * Send SMS message - pure send only, no message building
   */
  async sendSms(phoneNumber: string, message: string): Promise<SendSmsResult> {
    const smsLogId = randomUUID();
    await this.db.query(
      `
        INSERT INTO sms_logs (id, "recipientPhone", message, provider, status)
        VALUES ($1, $2, $3, $4, 'pending')
      `,
      [smsLogId, phoneNumber, message, this.provider],
    );

    try {
      let providerMessageId: string | undefined;

      if (this.provider === 'africastalking' && this.smsClient) {
        const response = await this.smsClient.send({
          to: [this.normalizePhoneNumber(phoneNumber)],
          message,
          from: this.senderId,
        });

        const recipients = response?.SMSMessageData?.Recipients;
        const firstRecipient = recipients?.[0];

        if (firstRecipient?.messageId) {
          providerMessageId = firstRecipient.messageId;
        }

        const messageStatus = firstRecipient?.status;
        if (messageStatus === 'Success' || messageStatus === 'Sent') {
          await this.updateSmsLog(smsLogId, 'sent', { providerMessageId });
        } else if (messageStatus === 'Failed' || messageStatus === 'Rejected') {
          await this.updateSmsLog(smsLogId, 'failed', {
            providerMessageId,
            error: firstRecipient?.status ?? messageStatus,
          });
        } else {
          await this.updateSmsLog(smsLogId, 'sent', { providerMessageId });
        }
      } else {
        this.logger.warn(
          `SMS provider not configured. Would send to ${phoneNumber}: ${message}`,
        );
        await this.updateSmsLog(smsLogId, 'sent');
      }

      return { providerMessageId };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to send SMS to ${phoneNumber}: ${errorMessage}`,
      );
      await this.updateSmsLog(smsLogId, 'failed', { error: errorMessage });
      throw error;
    }
  }

  private async updateSmsLog(
    id: string,
    status: 'pending' | 'sent' | 'delivered' | 'failed',
    values: { providerMessageId?: string; error?: string } = {},
  ): Promise<void> {
    await this.db.query(
      `
        UPDATE sms_logs
        SET status = $2,
          "providerMessageId" = COALESCE($3, "providerMessageId"),
          error = COALESCE($4, error),
          "updatedAt" = now()
        WHERE id = $1
      `,
      [id, status, values.providerMessageId ?? null, values.error ?? null],
    );
  }

  private normalizePhoneNumber(phone: string): string {
    let normalized = phone.replace(/\D/g, '');
    if (!normalized.startsWith('254')) {
      if (normalized.startsWith('0')) {
        normalized = '254' + normalized.slice(1);
      } else {
        normalized = '254' + normalized;
      }
    }
    return '+' + normalized;
  }
}
