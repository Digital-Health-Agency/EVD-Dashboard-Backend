import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { resolve } from 'path';
import { AuthModule } from './auth/auth.module.js';
import { envConfig } from './config/env.config.js';
import { DatabaseModule } from './database/database.module.js';
import { UserModule } from './modules/user/user.module.js';
import { NotificationModule } from './modules/notification/notification.module.js';
import { UploadModule } from './modules/upload/upload.module.js';
import { MailModule } from './modules/mail/mail.module.js';
import { SmsModule } from './modules/sms/sms.module.js';
import { HealthController } from './health.controller.js';

const uploadRoot = resolve(process.cwd(), process.env.UPLOAD_DIR ?? 'uploads');

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      load: [envConfig],
    }),
    DatabaseModule,
    ServeStaticModule.forRoot({
      rootPath: uploadRoot,
      serveRoot: '/uploads',
    }),
    AuthModule,
    UserModule,
    UploadModule,
    NotificationModule,
    MailModule,
    SmsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
