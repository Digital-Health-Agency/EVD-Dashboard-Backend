import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { newDb } from 'pg-mem';
import { Pool } from 'pg';

import { DatabaseService } from '../../database/database.module.js';
import { UploadService } from './upload.service.js';

describe('UploadService', () => {
  let service: UploadService;
  let db: DatabaseService;
  let pool: Pool;
  let module: TestingModule;

  beforeAll(async () => {
    const memoryDb = newDb();
    const adapter = memoryDb.adapters.createPg();
    pool = new adapter.Pool();
    db = new DatabaseService(pool);
    await db.ensureSchema();

    module = await Test.createTestingModule({
      providers: [UploadService, { provide: DatabaseService, useValue: db }],
    }).compile();

    service = module.get<UploadService>(UploadService);
  });

  afterAll(async () => {
    await module.close();
    await pool.end();
  });

  beforeEach(async () => {
    await db.query('DELETE FROM media');
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should save a file record', async () => {
    const mockFile = {
      filename: 'test-uuid.jpg',
      originalname: 'photo.jpg',
      mimetype: 'image/jpeg',
      size: 1024,
    } as Express.Multer.File;

    const media = await service.saveFile(mockFile, 'user-1', ['profile']);
    expect(media.originalName).toBe('photo.jpg');
    expect(media.uploadedBy).toBe('user-1');
    expect(media.path).toBe('/uploads/test-uuid.jpg');
    expect(media.mimeType).toBe('image/jpeg');
  });

  it('should find all media with pagination', async () => {
    await service.saveFile(
      {
        filename: 'f1.jpg',
        originalname: 'File 1',
        mimetype: 'image/jpeg',
        size: 100,
      } as Express.Multer.File,
      'user-1',
    );
    await service.saveFile(
      {
        filename: 'f2.png',
        originalname: 'File 2',
        mimetype: 'image/png',
        size: 200,
      } as Express.Multer.File,
      'user-1',
    );

    const result = await service.findAll(1, 10);
    expect(result.data).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it('should find one media by id', async () => {
    const created = await service.saveFile(
      {
        filename: 'f1.jpg',
        originalname: 'File 1',
        mimetype: 'image/jpeg',
        size: 100,
      } as Express.Multer.File,
      'user-1',
    );
    const found = await service.findOne(created.id);
    expect(found.originalName).toBe('File 1');
  });
});
