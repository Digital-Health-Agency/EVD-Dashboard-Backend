import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.module.js';
import { SmsDeliveryCallbackDto } from './dto/sms-delivery-callback.dto';

@Controller({ path: 'sms', version: '1' })
export class SmsController {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Africa's Talking SMS delivery report callback.
   * Configure this URL in Africa's Talking dashboard to receive delivery status updates.
   * AT retries until it receives 200 OK (up to 12 hours).
   */
  @Post('callbacks/delivery')
  @HttpCode(HttpStatus.OK)
  @UsePipes(
    new ValidationPipe({
      whitelist: false,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  )
  async deliveryCallback(@Body() body: SmsDeliveryCallbackDto) {
    const providerMessageId = body.id;
    const status = body.status;
    const failureReason = body.failureReason;

    if (providerMessageId && status) {
      const isDelivered = status === 'Success';
      const isFailed = status === 'Failed' || status === 'Rejected';

      await this.db.query(
        `
          UPDATE sms_logs
          SET
            "deliveryStatus" = $2,
            status = CASE
              WHEN $3 THEN 'delivered'
              WHEN $4 THEN 'failed'
              ELSE status
            END,
            "deliveredAt" = CASE WHEN $3 THEN now() ELSE "deliveredAt" END,
            error = CASE WHEN $4 THEN $5 ELSE error END,
            "updatedAt" = now()
          WHERE "providerMessageId" = $1
        `,
        [
          providerMessageId,
          status,
          isDelivered,
          isFailed,
          failureReason ?? status,
        ],
      );
    }

    return { success: true };
  }
}
