import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Model } from 'mongoose';
import { UploadService } from './upload.service.js';
import { Media, MediaSchema, MediaDocument } from './media.schema.js';

describe('UploadService', () => {
  let service: UploadService;
  let model: Model<MediaDocument>;
  let mongod: MongoMemoryServer;
  let module: TestingModule;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();

    module = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongod.getUri()),
        MongooseModule.forFeature([{ name: Media.name, schema: MediaSchema }]),
      ],
      providers: [UploadService],
    }).compile();

    service = module.get<UploadService>(UploadService);
    model = module.get<Model<MediaDocument>>(getModelToken(Media.name));
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
    await model.create({
      filename: 'f1.jpg',
      originalName: 'File 1',
      mimeType: 'image/jpeg',
      size: 100,
      path: '/uploads/f1.jpg',
    });
    await model.create({
      filename: 'f2.png',
      originalName: 'File 2',
      mimeType: 'image/png',
      size: 200,
      path: '/uploads/f2.png',
    });

    const result = await service.findAll(1, 10);
    expect(result.data).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it('should find one media by id', async () => {
    const created = await model.create({
      filename: 'f1.jpg',
      originalName: 'File 1',
      mimeType: 'image/jpeg',
      size: 100,
      path: '/uploads/f1.jpg',
    });
    const found = await service.findOne(created._id.toString());
    expect(found.originalName).toBe('File 1');
  });
});
