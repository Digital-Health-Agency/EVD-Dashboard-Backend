import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { HeadlineOverrideService } from './headline-override.service.js';

@Module({
  imports: [AuditModule],
  providers: [HeadlineOverrideService],
  exports: [HeadlineOverrideService],
})
export class HeadlineOverrideModule {}
