import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { Roles } from '../../common/guards/roles.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuditService, type AuditEventPage } from './audit.service.js';
import {
  auditQuerySchema,
  type AuditQueryDto,
} from './dto/audit-query.dto.js';

@Controller('api/audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('events')
  @UseGuards(RolesGuard)
  @Roles('admin')
  events(
    @Query(new ZodValidationPipe(auditQuerySchema))
    query: AuditQueryDto,
  ): Promise<AuditEventPage> {
    return this.audit.findAll(query);
  }
}
