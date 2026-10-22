import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NOTIFICATIONS_CONFIG, NotificationsConfigModule } from './config/notifications.config.js';
import { NotificationsService } from './notifications.service.js';
import { DEFAULT_JOB_OPTIONS, MAIL_QUEUE, WHATSAPP_QUEUE } from './queue/queue.constants.js';
import { PayloadCipher } from './security/payload-cipher.js';
import type { NotificationsConfig } from './types/notifications-config.types.js';

/**
 * For the API: queue notifications, send nothing. Needs Redis and the payload key, but no
 * AWS or AiSensy credentials: those belong to the worker app.
 */
@Module({
    imports: [
        NotificationsConfigModule,
        BullModule.forRootAsync({
            imports: [NotificationsConfigModule],
            inject: [NOTIFICATIONS_CONFIG],
            useFactory: (config: NotificationsConfig) => ({
                prefix: config.queuePrefix,
                connection: {
                    host: config.redis.host,
                    port: config.redis.port,
                    username: config.redis.username,
                    password: config.redis.password,
                    db: config.redis.db,
                    tls: config.redis.tls ? {} : undefined,
                    // A request handler must not hang while Redis is down: fail fast and let
                    // the caller carry on without the email.
                    enableOfflineQueue: false,
                },
            }),
        }),
        BullModule.registerQueue(
            { name: MAIL_QUEUE, defaultJobOptions: DEFAULT_JOB_OPTIONS },
            { name: WHATSAPP_QUEUE, defaultJobOptions: DEFAULT_JOB_OPTIONS },
        ),
    ],
    providers: [PayloadCipher, NotificationsService],
    exports: [NotificationsService],
})
export class NotificationsModule {}
