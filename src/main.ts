import './load-env.js';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter.js';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor.js';
import { ThrottleGuard } from './common/guards/throttle.guard.js';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const port = parseInt(process.env.PORT || '4000', 10);

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

  await app.listen(port);
  const address = await app.getUrl();
  logger.log(`Server listening on port ${port} (${address})`);
}
void bootstrap();
