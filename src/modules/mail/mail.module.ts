import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { MailService } from './mail.service';
import { MailLog, MailLogSchema } from './schemas/mail-log.schema';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([{ name: MailLog.name, schema: MailLogSchema }]),
  ],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
