import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Notification, NotificationDocument } from './notification.schema.js';

@Injectable()
export class NotificationService {
  constructor(
    @InjectModel(Notification.name)
    private notificationModel: Model<NotificationDocument>,
  ) {}

  async create(data: Partial<Notification>): Promise<NotificationDocument> {
    return this.notificationModel.create(data);
  }

  async findAll(
    page = 1,
    limit = 20,
    search?: string,
  ): Promise<{ data: NotificationDocument[]; total: number }> {
    const filter = search ? { title: { $regex: search, $options: 'i' } } : {};
    const [data, total] = await Promise.all([
      this.notificationModel
        .find(filter)
        .skip((page - 1) * limit)
        .limit(limit)
        .sort({ sentAt: -1 })
        .exec(),
      this.notificationModel.countDocuments(filter).exec(),
    ]);
    return { data, total };
  }

  async findOne(id: string): Promise<NotificationDocument> {
    const notification = await this.notificationModel.findById(id).exec();
    if (!notification)
      throw new NotFoundException(`Notification ${id} not found`);
    return notification;
  }

  async findByRecipient(
    recipientId: string,
    unreadOnly = false,
  ): Promise<NotificationDocument[]> {
    const filter: Record<string, unknown> = { recipientId };
    if (unreadOnly) filter.read = false;
    return this.notificationModel.find(filter).sort({ sentAt: -1 }).exec();
  }

  async markAsRead(id: string): Promise<NotificationDocument> {
    const notification = await this.notificationModel
      .findByIdAndUpdate(id, { read: true }, { returnDocument: 'after' })
      .exec();
    if (!notification)
      throw new NotFoundException(`Notification ${id} not found`);
    return notification;
  }

  async markAllRead(recipientId: string): Promise<{ modifiedCount: number }> {
    const result = await this.notificationModel
      .updateMany({ recipientId, read: false }, { $set: { read: true } })
      .exec();
    return { modifiedCount: result.modifiedCount };
  }

  async update(
    id: string,
    data: Partial<Notification>,
  ): Promise<NotificationDocument> {
    const notification = await this.notificationModel
      .findByIdAndUpdate(id, data, { returnDocument: 'after' })
      .exec();
    if (!notification)
      throw new NotFoundException(`Notification ${id} not found`);
    return notification;
  }

  async remove(id: string): Promise<void> {
    const result = await this.notificationModel.findByIdAndDelete(id).exec();
    if (!result) throw new NotFoundException(`Notification ${id} not found`);
  }
}
