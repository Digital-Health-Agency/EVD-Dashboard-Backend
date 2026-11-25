import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';

import { z } from 'zod';

import { Roles } from '../../common/guards/roles.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RECONCILIATION_ROLE } from '../../common/roles.js';
import { AnalyticsService } from '../analytics/analytics.service.js';
import {
  createHeadlineOverrideSchema,
  deleteHeadlineOverrideSchema,
  situationDateParamSchema,
  updateHeadlineOverrideSchema,
  type CreateHeadlineOverrideDto,
  type UpdateHeadlineOverrideDto,
} from './dto/headline-override.dto.js';
import type {
  HeadlineFigures,
  HeadlineOverrideRow,
} from './headline-override.schema.js';
import {
  HeadlineOverrideService,
  type HeadlineOverrideActor,
} from './headline-override.service.js';

const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

interface AuthenticatedRequest {
  user?: {
    id?: string;
    userId?: string;
    role?: string;
  };
}

function currentActor(req: AuthenticatedRequest): HeadlineOverrideActor {
  const actorId = req.user?.id ?? req.user?.userId;
  if (!actorId) throw new UnauthorizedException('Login required');
  return { actorId, actorRole: req.user?.role ?? null };
}

@Controller('api/reconciliation')
@UseGuards(RolesGuard)
@Roles(RECONCILIATION_ROLE)
export class ReconciliationController {
  constructor(
    private readonly overrides: HeadlineOverrideService,
    private readonly analytics: AnalyticsService,
  ) {}

  @Get('headline')
  async list(): Promise<{ data: HeadlineOverrideRow[] }> {
    return { data: await this.overrides.list() };
  }

  @Get('warehouse')
  warehouse(): Promise<{
    figures: HeadlineFigures;
    lastUpdated: string | null;
  }> {
    return this.analytics.getWarehouseHeadline();
  }

  @Get('headline/:situationDate')
  async one(
    @Param('situationDate', new ZodValidationPipe(situationDateParamSchema))
    situationDate: string,
  ): Promise<HeadlineOverrideRow> {
    const row = await this.overrides.find(situationDate);
    if (!row) {
      throw new NotFoundException(`Headline row ${situationDate} not found`);
    }
    return row;
  }

  @Get('headline/:situationDate/history')
  history(
    @Param('situationDate', new ZodValidationPipe(situationDateParamSchema))
    situationDate: string,
    @Query(new ZodValidationPipe(historyQuerySchema))
    query: z.infer<typeof historyQuerySchema>,
  ) {
    return this.overrides.history(situationDate, query.page, query.limit);
  }

  @Post('headline')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(createHeadlineOverrideSchema))
    body: CreateHeadlineOverrideDto,
  ): Promise<HeadlineOverrideRow> {
    return this.overrides.create(body, currentActor(req));
  }

  @Patch('headline/:situationDate')
  update(
    @Param('situationDate', new ZodValidationPipe(situationDateParamSchema))
    situationDate: string,
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(updateHeadlineOverrideSchema))
    body: UpdateHeadlineOverrideDto,
  ): Promise<HeadlineOverrideRow> {
    return this.overrides.update(situationDate, body, currentActor(req));
  }

  @Delete('headline/:situationDate')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('situationDate', new ZodValidationPipe(situationDateParamSchema))
    situationDate: string,
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(deleteHeadlineOverrideSchema))
    query: z.infer<typeof deleteHeadlineOverrideSchema>,
  ): Promise<void> {
    await this.overrides.remove(
      situationDate,
      currentActor(req),
      query.expected_revision,
      query.expected_record_id,
    );
  }
}
