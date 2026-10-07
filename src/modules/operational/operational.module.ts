import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { HeadlineOverrideModule } from '../reconciliation/headline-override.module.js';
import { LinelistController } from './linelist.controller.js';
import { LinelistExportController } from './linelist-export.controller.js';
import { LinelistExportService } from './linelist-export.service.js';
import { LinelistService } from './linelist.service.js';
import { OperationalController } from './operational.controller.js';
import { OperationalOptionsService } from './operational-options.service.js';
import { OperationalService } from './operational.service.js';

@Module({
  imports: [AuditModule, HeadlineOverrideModule],
  controllers: [
    OperationalController,
    LinelistController,
    LinelistExportController,
  ],
  providers: [
    OperationalService,
    OperationalOptionsService,
    LinelistService,
    LinelistExportService,
  ],
})
export class OperationalModule {}
