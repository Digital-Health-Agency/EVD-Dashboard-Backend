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

export class Notification {
  id!: string;
  _id!: string;

  recipientId!: string;

  type!: NotificationType;

  title!: string;

  message!: string;

  read!: boolean;

  link?: string;

  deliveryChannel!: DeliveryChannel;

  sentAt!: Date;

  createdAt?: Date;
  updatedAt?: Date;
}

export type NotificationDocument = Notification;
