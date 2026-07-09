import './load-env.js';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter.js';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor.js';
import { ThrottleGuard } from './common/guards/throttle.guard.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
  });

  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());
  app.useGlobalGuards(new ThrottleGuard());

  app.enableCors({
    origin: (
      process.env.TRUSTED_ORIGINS ||
      'http://localhost:3000,http://localhost:3001,http://localhost:3002,http://localhost:3003'
    ).split(','),
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 4000);
}
void bootstrap();
