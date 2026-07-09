import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type MailLogDocument = MailLog & Document;

@Schema({ timestamps: true })
export class MailLog {
  @Prop({ required: true })
  recipientEmail!: string;

  @Prop({ required: true })
  subject!: string;

  @Prop({ required: false })
  html?: string;

  @Prop({ required: false })
  text?: string;

  @Prop({ required: true, default: 'smtp' })
  provider!: string;

  @Prop({ required: false })
  providerMessageId?: string;

  @Prop({ required: true, default: 'pending' })
  status!: 'pending' | 'sent' | 'delivered' | 'failed';

  @Prop({ required: false })
  deliveryStatus?: string;

  @Prop({ required: false })
  deliveredAt?: Date;

  @Prop({ required: false })
  error?: string;
}

export const MailLogSchema = SchemaFactory.createForClass(MailLog);
MailLogSchema.index({ providerMessageId: 1 });
MailLogSchema.index({ recipientEmail: 1, createdAt: -1 });
