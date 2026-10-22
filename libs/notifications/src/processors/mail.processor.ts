import { Inject, Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError } from 'bullmq';
import type { Job } from 'bullmq';
import { z } from 'zod';
import { NOTIFICATIONS_CONFIG } from '../config/notifications.config.js';
import { toJobError } from '../errors/notification-delivery.error.js';
import { MAIL_QUEUE, SEND_MAIL_JOB } from '../queue/queue.constants.js';
import { PayloadCipher } from '../security/payload-cipher.js';
import { MAIL_TEMPLATES } from '../templates/mail-templates.js';
import { TemplateService } from '../templates/template.service.js';
import { MAIL_PROVIDER, MAIL_TEMPLATE_IDS } from '../types/mail.types.js';
import type { MailGlobals, MailProvider } from '../types/mail.types.js';
import type { MailJobData } from '../types/notification.types.js';
import type { NotificationsConfig } from '../types/notifications-config.types.js';
import { maskEmail } from '../utils/phone.js';
import { scrubSecrets } from './scrub-job.js';

const mailJobSchema = z.object({
    template: z.enum(MAIL_TEMPLATE_IDS),
    to: z.string().min(3),
    params: z.record(z.string(), z.string()),
    secure: z.string().optional(),
});

/** Turns a queued email job into a sent message: decrypt, check, render, send. */
@Processor(MAIL_QUEUE, { concurrency: 5 })
export class MailProcessor extends WorkerHost {
    private readonly logger = new Logger(MailProcessor.name);

    constructor(
        @Inject(NOTIFICATIONS_CONFIG) private readonly config: NotificationsConfig,
        @Inject(MAIL_PROVIDER) private readonly provider: MailProvider,
        private readonly templates: TemplateService,
        private readonly cipher: PayloadCipher,
    ) {
        super();
    }

    async process(job: Job<MailJobData>): Promise<void> {
        if (job.name !== SEND_MAIL_JOB) throw new UnrecoverableError(`Unexpected job name: ${job.name}`);

        // Anything wrong with the job itself will be just as wrong on the next attempt.
        let mail;
        try {
            mail = this.prepare(job.data);
        } catch (error) {
            throw new UnrecoverableError(`Invalid mail job: ${error instanceof Error ? error.message : String(error)}`);
        }

        try {
            await this.provider.send(mail);
        } catch (error) {
            throw toJobError(error);
        }

        await scrubSecrets(job);
        this.logger.log(`Sent "${job.data.template}" to ${maskEmail(mail.to)} (job ${job.id})`);
    }

    private prepare(raw: MailJobData) {
        const data = mailJobSchema.parse(raw);
        const template = MAIL_TEMPLATES[data.template];
        const secrets = data.secure ? this.cipher.decrypt(data.secure) : {};
        const input = { ...data.params, ...secrets };

        const globals: MailGlobals = {
            appName: this.config.appName,
            staffConsoleUrl: this.config.staffConsoleUrl,
            testPortalUrl: this.config.testPortalUrl,
            year: new Date().getFullYear(),
        };
        const { sender, subject, view } = template.prepare(input, globals);
        const { html, text } = this.templates.renderMail(data.template, view);
        return { sender, to: data.to, subject, html, text };
    }

    @OnWorkerEvent('failed')
    async onFailed(job: Job<MailJobData> | undefined, error: Error): Promise<void> {
        if (!job) return;
        const attempts = job.opts.attempts ?? 1;
        const finished = job.attemptsMade >= attempts || error instanceof UnrecoverableError;
        this.logger.warn(
            `Mail job ${job.id} (${job.data.template} to ${maskEmail(job.data.to)}) failed, attempt ${job.attemptsMade}/${attempts}: ${error.message}${finished ? ' - giving up' : ''}`,
        );
        if (finished) await scrubSecrets(job);
    }
}
