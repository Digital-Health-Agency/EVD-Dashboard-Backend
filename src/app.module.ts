import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ServeStaticModule } from '@nestjs/serve-static';
import { resolve } from 'path';
import { AuthModule } from './auth/auth.module.js';
import { UserModule } from './modules/user/user.module.js';
import { NotificationModule } from './modules/notification/notification.module.js';
import { UploadModule } from './modules/upload/upload.module.js';
import { MailModule } from './modules/mail/mail.module.js';
import { PostgresModule } from './modules/postgres/postgres.module.js';
import { SmsModule } from './modules/sms/sms.module.js';
import { HealthController } from './health.controller.js';

const uploadRoot = resolve(process.cwd(), process.env.UPLOAD_DIR ?? 'uploads');

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    MongooseModule.forRoot(
      process.env.MONGODB_URI || 'mongodb://localhost:27017/evd',
    ),
    PostgresModule,
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
