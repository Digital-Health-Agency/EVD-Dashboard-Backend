import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Model } from 'mongoose';
import { NotificationService } from './notification.service.js';
import {
  Notification,
  NotificationSchema,
  NotificationDocument,
  NotificationType,
} from './notification.schema.js';

describe('NotificationService', () => {
  let service: NotificationService;
  let model: Model<NotificationDocument>;
  let mongod: MongoMemoryServer;
  let module: TestingModule;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();

    module = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongod.getUri()),
        MongooseModule.forFeature([
          { name: Notification.name, schema: NotificationSchema },
        ]),
      ],
      providers: [NotificationService],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
    model = module.get<Model<NotificationDocument>>(
      getModelToken(Notification.name),
    );
  });

  afterAll(async () => {
    await module.close();
    await mongod.stop();
  });

  beforeEach(async () => {
    await model.deleteMany({});
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create a notification', async () => {
    const notif = await service.create({
      recipientId: 'user-1',
      type: NotificationType.ALERT,
      title: 'Welcome',
      message: 'You have been registered',
    });
    expect(notif.title).toBe('Welcome');
  });

  it('should find all notifications with pagination', async () => {
    await service.create({
      recipientId: 'u1',
      type: NotificationType.REPORT,
      title: 'N1',
      message: 'msg1',
    });
    await service.create({
      recipientId: 'u2',
      type: NotificationType.SYSTEM,
      title: 'N2',
      message: 'msg2',
    });

    const result = await service.findAll(1, 10);
    expect(result.data).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it('should find one notification by id', async () => {
    const created = await service.create({
      recipientId: 'u1',
      type: NotificationType.REPORT,
      title: 'Cert Ready',
      message: 'Your report is ready',
    });
    const found = await service.findOne(created._id.toString());
    expect(found.title).toBe('Cert Ready');
  });

  it('should update a notification', async () => {
    const created = await service.create({
      recipientId: 'u1',
      type: NotificationType.SYSTEM,
      title: 'Old',
      message: 'old msg',
    });
    const updated = await service.update(created._id.toString(), {
      title: 'Updated',
    });
    expect(updated.title).toBe('Updated');
  });

  it('should delete a notification', async () => {
    const created = await service.create({
      recipientId: 'u1',
      type: NotificationType.TASK,
      title: 'Delete Me',
      message: 'msg',
    });
    await service.remove(created._id.toString());
    const count = await model.countDocuments();
    expect(count).toBe(0);
  });

  it('should mark a single notification as read', async () => {
    const created = await service.create({
      recipientId: 'u1',
      type: NotificationType.SYSTEM,
      title: 'Unread',
      message: 'msg',
    });
    expect(created.read).toBe(false);
    const updated = await service.markAsRead(created._id.toString());
    expect(updated.read).toBe(true);
  });

  it('should mark all notifications as read for a recipient', async () => {
    await service.create({
      recipientId: 'u1',
      type: NotificationType.SYSTEM,
      title: 'N1',
      message: 'm1',
    });
    await service.create({
      recipientId: 'u1',
      type: NotificationType.TASK,
      title: 'N2',
      message: 'm2',
    });
    await service.create({
      recipientId: 'u2',
      type: NotificationType.SYSTEM,
      title: 'N3',
      message: 'm3',
    });

    const result = await service.markAllRead('u1');
    expect(result.modifiedCount).toBe(2);

    const u1Notifications = await service.findByRecipient('u1', true);
    expect(u1Notifications).toHaveLength(0);

    const u2Notifications = await service.findByRecipient('u2', true);
    expect(u2Notifications).toHaveLength(1);
  });

  it('should filter notifications by unread status', async () => {
    const n1 = await service.create({
      recipientId: 'u1',
      type: NotificationType.SYSTEM,
      title: 'Unread',
      message: 'msg',
    });
    await service.create({
      recipientId: 'u1',
      type: NotificationType.ALERT,
      title: 'Also Unread',
      message: 'msg2',
    });
    await service.markAsRead(n1._id.toString());

    const all = await service.findByRecipient('u1');
    expect(all).toHaveLength(2);

    const unread = await service.findByRecipient('u1', true);
    expect(unread).toHaveLength(1);
    expect(unread[0].title).toBe('Also Unread');
  });

  it('should create a notification with a link', async () => {
    const notif = await service.create({
      recipientId: 'u1',
      type: NotificationType.ALERT,
      title: 'Link Test',
      message: 'Click to view',
      link: '/executive',
    });
    expect(notif.link).toBe('/executive');
  });
});
