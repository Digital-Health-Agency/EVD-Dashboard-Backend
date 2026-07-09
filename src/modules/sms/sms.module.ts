import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { SmsService } from './sms.service';
import { SmsController } from './sms.controller';
import { SmsLog, SmsLogSchema } from './schemas/sms-log.schema';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([{ name: SmsLog.name, schema: SmsLogSchema }]),
  ],
  controllers: [SmsController],
  providers: [SmsService],
  exports: [SmsService],
})
export class SmsModule {}
