import { Module } from '@nestjs/common';

import { AnalyticsModule } from '../analytics/analytics.module.js';
import { HeadlineOverrideModule } from './headline-override.module.js';
import { ReconciliationController } from './reconciliation.controller.js';

@Module({
  imports: [HeadlineOverrideModule, AnalyticsModule],
  controllers: [ReconciliationController],
})
export class ReconciliationModule {}
