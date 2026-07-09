import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SmsLogDocument = SmsLog & Document;

@Schema({ timestamps: true })
export class SmsLog {
  @Prop({ required: true })
  recipientPhone!: string;

  @Prop({ required: true })
  message!: string;

  @Prop({ required: true, default: 'africastalking' })
  provider!: string;

  @Prop({ required: false })
  providerMessageId?: string;

  @Prop({ required: true, default: 'pending' })
  status!: 'pending' | 'sent' | 'delivered' | 'failed';

  @Prop({ required: false })
  deliveryStatus?: string; // From callback: Success, Failed, Rejected, Submitted, Buffered

  @Prop({ required: false })
  deliveredAt?: Date;

  @Prop({ required: false })
  error?: string;
}

export const SmsLogSchema = SchemaFactory.createForClass(SmsLog);
SmsLogSchema.index({ providerMessageId: 1 });
