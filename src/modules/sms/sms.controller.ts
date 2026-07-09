import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SmsLog, SmsLogDocument } from './schemas/sms-log.schema';
import { SmsDeliveryCallbackDto } from './dto/sms-delivery-callback.dto';

@Controller({ path: 'sms', version: '1' })
export class SmsController {
  constructor(
    @InjectModel(SmsLog.name)
    private readonly smsLogModel: Model<SmsLogDocument>,
  ) {}

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

      await this.smsLogModel
        .updateOne(
          { providerMessageId },
          {
            $set: {
              deliveryStatus: status,
              ...(isDelivered && {
                status: 'delivered',
                deliveredAt: new Date(),
              }),
              ...(isFailed && {
                status: 'failed',
                error: failureReason ?? status,
              }),
            },
          },
        )
        .exec();
    }

    return { success: true };
  }
}
