import { Controller, Get, Query, Req } from '@nestjs/common';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import {
  linelistQuerySchema,
  type LinelistQueryDto,
} from './dto/linelist-query.dto.js';
import {
  LinelistService,
  type LinelistAccess,
  type LinelistPage,
  type LinelistRow,
} from './linelist.service.js';

export interface AuthenticatedRequest {
  user?: {
    id?: string;
    userId?: string;
    role?: string;
  };
}

export function resolveLinelistAccess(
  req?: AuthenticatedRequest,
): LinelistAccess {
  const userId = req?.user?.id ?? req?.user?.userId ?? null;
  const role = req?.user?.role ?? null;
  return {
    userId,
    role,
    allowPii: userId !== null,
  };
}

@Controller('api/operational/linelist')
export class LinelistController {
  constructor(private readonly linelist: LinelistService) {}

  @Get('lab-results')
  labResults(
    @Query(new ZodValidationPipe(linelistQuerySchema))
    query: LinelistQueryDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<LinelistPage<LinelistRow>> {
    return this.linelist.labResults(query, resolveLinelistAccess(req));
  }

  @Get('screenings')
  screenings(
    @Query(new ZodValidationPipe(linelistQuerySchema))
    query: LinelistQueryDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<LinelistPage<LinelistRow>> {
    return this.linelist.screenings(query, resolveLinelistAccess(req));
  }

  @Get('cases')
  cases(
    @Query(new ZodValidationPipe(linelistQuerySchema))
    query: LinelistQueryDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<LinelistPage<LinelistRow>> {
    return this.linelist.cases(query, resolveLinelistAccess(req));
  }

  @Get('outcomes')
  outcomes(
    @Query(new ZodValidationPipe(linelistQuerySchema))
    query: LinelistQueryDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<LinelistPage<LinelistRow>> {
    return this.linelist.outcomes(query, resolveLinelistAccess(req));
  }

  @Get('contacts')
  contacts(
    @Query(new ZodValidationPipe(linelistQuerySchema))
    query: LinelistQueryDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<LinelistPage<LinelistRow>> {
    return this.linelist.contacts(query, resolveLinelistAccess(req));
  }

  @Get('signals')
  signals(
    @Query(new ZodValidationPipe(linelistQuerySchema))
    query: LinelistQueryDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<LinelistPage<LinelistRow>> {
    return this.linelist.signals(query, resolveLinelistAccess(req));
  }
}
