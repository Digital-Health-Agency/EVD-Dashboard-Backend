import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as path from 'path';
import * as fs from 'fs';
import { Media, MediaDocument } from './media.schema.js';

export function resolveUploadDir(): string {
  return path.resolve(process.cwd(), process.env.UPLOAD_DIR ?? 'uploads');
}

@Injectable()
export class UploadService {
  private readonly uploadDir = resolveUploadDir();

  constructor(
    @InjectModel(Media.name) private mediaModel: Model<MediaDocument>,
  ) {
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  async saveFile(
    file: Express.Multer.File,
    uploadedBy: string,
    tags: string[] = [],
  ): Promise<MediaDocument> {
    const media = new this.mediaModel({
      filename: file.filename,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      path: `/uploads/${file.filename}`,
      uploadedBy,
      tags,
    });
    return media.save();
  }

  async findAll(
    page = 1,
    limit = 20,
    search?: string,
  ): Promise<{ data: MediaDocument[]; total: number }> {
    const filter = search
      ? { originalName: { $regex: search, $options: 'i' } }
      : {};
    const [data, total] = await Promise.all([
      this.mediaModel
        .find(filter)
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.mediaModel.countDocuments(filter).exec(),
    ]);
    return { data, total };
  }

  async findOne(id: string): Promise<MediaDocument> {
    const media = await this.mediaModel.findById(id).exec();
    if (!media) throw new NotFoundException(`Media ${id} not found`);
    return media;
  }

  async remove(id: string): Promise<void> {
    const media = await this.mediaModel.findById(id).exec();
    if (!media) throw new NotFoundException(`Media ${id} not found`);
    const filePath = path.join(this.uploadDir, media.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    await this.mediaModel.findByIdAndDelete(id).exec();
  }
}
