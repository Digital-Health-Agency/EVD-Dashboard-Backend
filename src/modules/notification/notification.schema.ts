import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type NotificationDocument = HydratedDocument<Notification>;

export enum NotificationType {
  SYSTEM = 'system',
  ALERT = 'alert',
  REPORT = 'report',
  TASK = 'task',
}

export enum DeliveryChannel {
  IN_APP = 'inApp',
  EMAIL = 'email',
  SMS = 'sms',
}

@Schema({ timestamps: true })
export class Notification {
  @Prop({ required: true })
  recipientId!: string;

  @Prop({ type: String, enum: NotificationType, required: true })
  type!: NotificationType;

  @Prop({ required: true })
  title!: string;

  @Prop({ required: true })
  message!: string;

  @Prop({ default: false })
  read!: boolean;

  @Prop()
  link?: string;

  @Prop({
    type: String,
    enum: DeliveryChannel,
    default: DeliveryChannel.IN_APP,
  })
  deliveryChannel!: DeliveryChannel;

  @Prop({ default: () => new Date() })
  sentAt!: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);
