import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../database/database.module.js';
import {
  DeliveryChannel,
  Notification,
  NotificationDocument,
} from './notification.schema.js';

@Injectable()
export class NotificationService {
  constructor(private readonly db: DatabaseService) {}

  private rowToNotification(row: NotificationDocument): NotificationDocument {
    return { ...row, _id: row.id };
  }

  async create(data: Partial<Notification>): Promise<NotificationDocument> {
    const result = await this.db.query<NotificationDocument>(
      `
        INSERT INTO notifications (
          id, "recipientId", type, title, message, read, link, "deliveryChannel", "sentAt"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, now()))
        RETURNING *
      `,
      [
        randomUUID(),
        data.recipientId,
        data.type,
        data.title,
        data.message,
        data.read ?? false,
        data.link ?? null,
        data.deliveryChannel ?? DeliveryChannel.IN_APP,
        data.sentAt ?? null,
      ],
    );
    return this.rowToNotification(result.rows[0]);
  }

  async findAll(
    page = 1,
    limit = 20,
    search?: string,
  ): Promise<{ data: NotificationDocument[]; total: number }> {
    const values: unknown[] = [];
    let where = '';
    if (search) {
      values.push(`%${search}%`);
      where = `WHERE title ILIKE $${values.length}`;
    }
    const offset = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.db.query<NotificationDocument>(
        `SELECT * FROM notifications ${where} ORDER BY "sentAt" DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, limit, offset],
      ),
      this.db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM notifications ${where}`,
        values,
      ),
    ]);
    return {
      data: data.rows.map((row) => this.rowToNotification(row)),
      total: Number(total.rows[0].count),
    };
  }

  async findOne(id: string): Promise<NotificationDocument> {
    const result = await this.db.query<NotificationDocument>(
      'SELECT * FROM notifications WHERE id = $1',
      [id],
    );
    const notification = result.rows[0]
      ? this.rowToNotification(result.rows[0])
      : null;
    if (!notification)
      throw new NotFoundException(`Notification ${id} not found`);
    return notification;
  }

  async findByRecipient(
    recipientId: string,
    unreadOnly = false,
  ): Promise<NotificationDocument[]> {
    const result = await this.db.query<NotificationDocument>(
      `SELECT * FROM notifications WHERE "recipientId" = $1 ${unreadOnly ? 'AND read = false' : ''} ORDER BY "sentAt" DESC`,
      [recipientId],
    );
    return result.rows.map((row) => this.rowToNotification(row));
  }

  async markAsRead(id: string): Promise<NotificationDocument> {
    const result = await this.db.query<NotificationDocument>(
      'UPDATE notifications SET read = true, "updatedAt" = now() WHERE id = $1 RETURNING *',
      [id],
    );
    const notification = result.rows[0]
      ? this.rowToNotification(result.rows[0])
      : null;
    if (!notification)
      throw new NotFoundException(`Notification ${id} not found`);
    return notification;
  }

  async markAllRead(recipientId: string): Promise<{ modifiedCount: number }> {
    const result = await this.db.query(
      'UPDATE notifications SET read = true, "updatedAt" = now() WHERE "recipientId" = $1 AND read = false',
      [recipientId],
    );
    return { modifiedCount: result.rowCount ?? 0 };
  }

  async update(
    id: string,
    data: Partial<Notification>,
  ): Promise<NotificationDocument> {
    const current = await this.findOne(id);
    const result = await this.db.query<NotificationDocument>(
      `
        UPDATE notifications
        SET
          "recipientId" = $2,
          type = $3,
          title = $4,
          message = $5,
          read = $6,
          link = $7,
          "deliveryChannel" = $8,
          "sentAt" = $9,
          "updatedAt" = now()
        WHERE id = $1
        RETURNING *
      `,
      [
        id,
        data.recipientId ?? current.recipientId,
        data.type ?? current.type,
        data.title ?? current.title,
        data.message ?? current.message,
        data.read ?? current.read,
        data.link ?? current.link ?? null,
        data.deliveryChannel ?? current.deliveryChannel,
        data.sentAt ?? current.sentAt,
      ],
    );
    const notification = result.rows[0]
      ? this.rowToNotification(result.rows[0])
      : null;
    if (!notification)
      throw new NotFoundException(`Notification ${id} not found`);
    return notification;
  }

  async remove(id: string): Promise<void> {
    const result = await this.db.query(
      'DELETE FROM notifications WHERE id = $1',
      [id],
    );
    if (!result.rowCount)
      throw new NotFoundException(`Notification ${id} not found`);
  }
}
