import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Req,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import * as fs from 'fs';
import { resolveUploadDir, UploadService } from './upload.service.js';

/** Max upload size (brochure PDFs). Event banners and logos use the same endpoint. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

interface AuthenticatedRequest {
  user?: {
    id?: string;
    userId?: string;
  };
}

interface SerializedMedia {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  path: string;
  uploadedBy?: string;
  tags: string[];
}

function currentUserId(req: AuthenticatedRequest): string {
  const id = req.user?.id ?? req.user?.userId;
  if (!id) throw new UnauthorizedException('Login required');
  return id;
}

function stringifyId(value: unknown): string {
  if (typeof value === 'string') return value;
  if (hasHexString(value)) return value.toHexString();
  return '';
}

function hasHexString(value: unknown): value is { toHexString(): string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'toHexString' in value &&
    typeof value.toHexString === 'function'
  );
}

@Controller('api/upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const uploadDir = resolveUploadDir();
          fs.mkdirSync(uploadDir, { recursive: true });
          cb(null, uploadDir);
        },
        filename: (_req, file, cb) => {
          const ext = path.extname(file.originalname);
          cb(null, `${uuidv4()}${ext}`);
        },
      }),
      limits: { fileSize: MAX_UPLOAD_BYTES },
    }),
  )
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: AuthenticatedRequest,
  ): Promise<SerializedMedia> {
    const media = await this.uploadService.saveFile(file, currentUserId(req));
    return this.serialize(media);
  }

  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.uploadService.findAll(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
      search,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.uploadService.findOne(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.uploadService.remove(id);
  }

  private serialize(media: {
    _id?: unknown;
    id?: string;
    filename: string;
    originalName: string;
    mimeType: string;
    size: number;
    path: string;
    uploadedBy?: string;
    tags?: string[];
  }): SerializedMedia {
    return {
      id: stringifyId(media._id ?? media.id),
      filename: media.filename,
      originalName: media.originalName,
      mimeType: media.mimeType,
      size: media.size,
      path: media.path,
      uploadedBy: media.uploadedBy,
      tags: media.tags ?? [],
    };
  }
}
