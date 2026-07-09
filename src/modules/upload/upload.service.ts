import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as path from 'path';
import * as fs from 'fs';
import { DatabaseService } from '../../database/database.module.js';
import { MediaDocument } from './media.schema.js';

export function resolveUploadDir(): string {
  return path.resolve(process.cwd(), process.env.UPLOAD_DIR ?? 'uploads');
}

@Injectable()
export class UploadService {
  private readonly uploadDir = resolveUploadDir();

  constructor(private readonly db: DatabaseService) {
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  private rowToMedia(row: MediaDocument): MediaDocument {
    return {
      ...row,
      _id: row.id,
      tags: row.tags ?? [],
    };
  }

  async saveFile(
    file: Express.Multer.File,
    uploadedBy: string,
    tags: string[] = [],
  ): Promise<MediaDocument> {
    const result = await this.db.query<MediaDocument>(
      `
        INSERT INTO media (id, filename, "originalName", "mimeType", size, path, "uploadedBy", tags)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `,
      [
        randomUUID(),
        file.filename,
        file.originalname,
        file.mimetype,
        file.size,
        `/uploads/${file.filename}`,
        uploadedBy,
        tags,
      ],
    );
    return this.rowToMedia(result.rows[0]);
  }

  async findAll(
    page = 1,
    limit = 20,
    search?: string,
  ): Promise<{ data: MediaDocument[]; total: number }> {
    const values: unknown[] = [];
    let where = '';
    if (search) {
      values.push(`%${search}%`);
      where = `WHERE "originalName" ILIKE $${values.length}`;
    }
    const offset = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.db.query<MediaDocument>(
        `SELECT * FROM media ${where} ORDER BY "createdAt" DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, limit, offset],
      ),
      this.db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM media ${where}`,
        values,
      ),
    ]);
    return {
      data: data.rows.map((row) => this.rowToMedia(row)),
      total: Number(total.rows[0].count),
    };
  }

  async findOne(id: string): Promise<MediaDocument> {
    const result = await this.db.query<MediaDocument>(
      'SELECT * FROM media WHERE id = $1',
      [id],
    );
    const media = result.rows[0] ? this.rowToMedia(result.rows[0]) : null;
    if (!media) throw new NotFoundException(`Media ${id} not found`);
    return media;
  }

  async remove(id: string): Promise<void> {
    const media = await this.findOne(id);
    if (!media) throw new NotFoundException(`Media ${id} not found`);
    const filePath = path.join(this.uploadDir, media.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    await this.db.query('DELETE FROM media WHERE id = $1', [id]);
  }
}
