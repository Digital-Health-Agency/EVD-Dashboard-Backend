import { Controller, Get } from '@nestjs/common';
import { Public } from '@thallesp/nestjs-better-auth';

import { AnalyticsService } from './analytics.service.js';

@Controller('api/analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('metrics')
  @Public()
  metrics(): Promise<unknown> {
    return this.analytics.getMetrics();
  }
}
