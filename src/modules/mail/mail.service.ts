import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import * as nodemailer from 'nodemailer';
import { DatabaseService } from '../../database/database.module.js';

export interface SendMailResult {
  providerMessageId?: string;
}

export interface SendMailParams {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  attachments?: nodemailer.SendMailOptions['attachments'];
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly provider: string;
  private transporter: nodemailer.Transporter | null = null;
  private transporterResolved = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly db: DatabaseService,
  ) {
    this.provider = this.configService.get<string>('MAIL_PROVIDER') || 'smtp';
  }

  private getTransporter(): nodemailer.Transporter | null {
    if (this.transporterResolved) {
      return this.transporter;
    }
    this.transporterResolved = true;

    const host = this.configService.get<string>('SMTP_HOST');
    const portStr = this.configService.get<string>('SMTP_PORT');
    if (!host || !portStr) {
      this.transporter = null;
      return null;
    }

    const port = parseInt(portStr, 10);
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');
    const secure = this.configService.get<string>('SMTP_SECURE') === 'true';

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user && pass ? { user, pass } : undefined,
    });
    return this.transporter;
  }

  async sendMail(params: SendMailParams): Promise<SendMailResult> {
    const { to, subject, html, text, attachments } = params;

    const mailLogId = randomUUID();
    await this.db.query(
      `
        INSERT INTO mail_logs (id, "recipientEmail", subject, html, text, provider, status)
        VALUES ($1, $2, $3, $4, $5, $6, 'pending')
      `,
      [mailLogId, to, subject, html ?? null, text ?? null, this.provider],
    );

    try {
      let providerMessageId: string | undefined;

      const transporter = this.getTransporter();
      const from =
        this.configService.get<string>('MAIL_FROM') ||
        this.configService.get<string>('SMTP_FROM') ||
        'noreply@evd.local';
      const fromName =
        this.configService.get<string>('MAIL_FROM_NAME') || 'DHA EVD';

      if (transporter) {
        const info = (await transporter.sendMail({
          from: `"${fromName}" <${from}>`,
          to,
          subject,
          html,
          text,
          attachments,
        })) as unknown as { messageId?: string };
        providerMessageId = info.messageId;
        await this.updateMailLog(mailLogId, 'sent', {
          providerMessageId,
        });
      } else {
        this.logger.warn(
          `Mail provider not configured. Would send to ${to}: ${subject}`,
        );
        await this.updateMailLog(mailLogId, 'sent');
      }

      return { providerMessageId };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to send mail to ${to}: ${message}`);
      await this.updateMailLog(mailLogId, 'failed', { error: message });
      throw error;
    }
  }

  private async updateMailLog(
    id: string,
    status: 'pending' | 'sent' | 'delivered' | 'failed',
    values: { providerMessageId?: string; error?: string } = {},
  ): Promise<void> {
    await this.db.query(
      `
        UPDATE mail_logs
        SET status = $2,
          "providerMessageId" = COALESCE($3, "providerMessageId"),
          error = COALESCE($4, error),
          "updatedAt" = now()
        WHERE id = $1
      `,
      [id, status, values.providerMessageId ?? null, values.error ?? null],
    );
  }
}
