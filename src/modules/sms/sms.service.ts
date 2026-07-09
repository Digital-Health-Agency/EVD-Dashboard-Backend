import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import AfricasTalking from 'africastalking';
import { SmsLog, SmsLogDocument } from './schemas/sms-log.schema';

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
    @InjectModel(SmsLog.name)
    private readonly smsLogModel: Model<SmsLogDocument>,
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
    const smsLog = new this.smsLogModel({
      recipientPhone: phoneNumber,
      message,
      provider: this.provider,
      status: 'pending',
    });

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
          smsLog.status = 'sent';
        } else if (messageStatus === 'Failed' || messageStatus === 'Rejected') {
          smsLog.status = 'failed';
          smsLog.error = firstRecipient?.status ?? messageStatus;
        } else {
          smsLog.status = 'sent';
        }

        smsLog.providerMessageId = providerMessageId;
      } else {
        this.logger.warn(
          `SMS provider not configured. Would send to ${phoneNumber}: ${message}`,
        );
        smsLog.status = 'sent';
      }

      await smsLog.save();

      return { providerMessageId };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to send SMS to ${phoneNumber}: ${errorMessage}`,
      );
      smsLog.status = 'failed';
      smsLog.error = errorMessage;
      await smsLog.save();
      throw error;
    }
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
