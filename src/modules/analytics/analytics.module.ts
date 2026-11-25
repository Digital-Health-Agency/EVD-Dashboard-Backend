import { Module } from '@nestjs/common';

import { HeadlineOverrideModule } from '../reconciliation/headline-override.module.js';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsService } from './analytics.service.js';

@Module({
  imports: [HeadlineOverrideModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
