import { describe, expect, it, vi } from 'vitest';
import { NotificationController } from './notification.controller.js';
import type { NotificationService } from './notification.service.js';

describe('NotificationController', () => {
  it('uses the authenticated user for the notification inbox', async () => {
    const findByRecipient = vi.fn().mockResolvedValue([{ id: 'n1' }]);
    const notificationService = {
      findByRecipient,
    } as unknown as NotificationService;
    const controller = new NotificationController(notificationService);

    const result = await controller.findMine(
      { user: { id: 'user-1' } },
      'true',
    );

    expect(findByRecipient).toHaveBeenCalledWith('user-1', true);
    expect(result).toEqual([{ id: 'n1' }]);
  });

  it('marks all notifications read for the authenticated user', async () => {
    const markAllRead = vi.fn().mockResolvedValue({ modifiedCount: 2 });
    const notificationService = {
      markAllRead,
    } as unknown as NotificationService;
    const controller = new NotificationController(notificationService);

    const result = await controller.markMineRead({
      user: { id: 'user-1' },
    });

    expect(markAllRead).toHaveBeenCalledWith('user-1');
    expect(result).toEqual({ modifiedCount: 2 });
  });
});
