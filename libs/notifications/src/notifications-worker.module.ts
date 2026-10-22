import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConsoleMailProvider } from './channels/mail/console-mail.provider.js';
import { SesMailProvider } from './channels/mail/ses-mail.provider.js';
import { AiSensyProvider } from './channels/whatsapp/aisensy.provider.js';
import { ConsoleWhatsAppProvider } from './channels/whatsapp/console-whatsapp.provider.js';
import { NOTIFICATIONS_CONFIG, NotificationsConfigModule } from './config/notifications.config.js';
import { MailProcessor } from './processors/mail.processor.js';
import { WhatsAppProcessor } from './processors/whatsapp.processor.js';
import { DEFAULT_JOB_OPTIONS, MAIL_QUEUE, WHATSAPP_QUEUE } from './queue/queue.constants.js';
import { PayloadCipher } from './security/payload-cipher.js';
import { TemplateService } from './templates/template.service.js';
import { MAIL_PROVIDER } from './types/mail.types.js';
import type { NotificationsConfig } from './types/notifications-config.types.js';
import { WHATSAPP_PROVIDER } from './types/whatsapp.types.js';

/** For the worker app: consume the queues and deliver through SES and AiSensy. */
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
                },
            }),
        }),
        BullModule.registerQueue(
            { name: MAIL_QUEUE, defaultJobOptions: DEFAULT_JOB_OPTIONS },
            { name: WHATSAPP_QUEUE, defaultJobOptions: DEFAULT_JOB_OPTIONS },
        ),
    ],
    providers: [
        PayloadCipher,
        TemplateService,
        {
            provide: MAIL_PROVIDER,
            inject: [NOTIFICATIONS_CONFIG],
            useFactory: (config: NotificationsConfig) =>
                config.mail.driver === 'ses' ? new SesMailProvider(config.mail) : new ConsoleMailProvider(),
        },
        {
            provide: WHATSAPP_PROVIDER,
            inject: [NOTIFICATIONS_CONFIG],
            useFactory: (config: NotificationsConfig) =>
                config.whatsapp.driver === 'aisensy'
                    ? new AiSensyProvider(config.whatsapp)
                    : new ConsoleWhatsAppProvider(),
        },
        MailProcessor,
        WhatsAppProcessor,
    ],
})
export class NotificationsWorkerModule {}
