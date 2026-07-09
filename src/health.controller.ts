import { Controller, Get } from '@nestjs/common';
import { Public } from '@thallesp/nestjs-better-auth';

@Controller('health')
export class HealthController {
  @Get()
  @Public()
  check() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }
}
