import { describe, expect, it, vi } from 'vitest';
import { UploadController } from './upload.controller.js';
import type { UploadService } from './upload.service.js';

describe('UploadController', () => {
  it('persists uploaded file metadata through UploadService', async () => {
    const file = {
      filename: 'generated-name.png',
      originalname: 'chart.png',
      mimetype: 'image/png',
      size: 2048,
    } as Express.Multer.File;
    const saved = {
      _id: 'media-1',
      filename: file.filename,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      path: '/uploads/generated-name.png',
      uploadedBy: 'user-1',
      tags: [],
    };
    const saveFile = vi.fn().mockResolvedValue(saved);
    const uploadService = {
      saveFile,
    } as unknown as UploadService;
    const controller = new UploadController(uploadService);

    const result = await controller.uploadFile(file, {
      user: { id: 'user-1' },
    });

    expect(saveFile).toHaveBeenCalledWith(file, 'user-1');
    expect(result).toMatchObject({
      id: 'media-1',
      filename: 'generated-name.png',
      originalName: 'chart.png',
      mimeType: 'image/png',
      size: 2048,
      path: '/uploads/generated-name.png',
      uploadedBy: 'user-1',
      tags: [],
    });
  });
});
