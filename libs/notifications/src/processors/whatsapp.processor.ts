import { Inject, Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError } from 'bullmq';
import type { Job } from 'bullmq';
import { z } from 'zod';
import { toJobError } from '../errors/notification-delivery.error.js';
import { SEND_WHATSAPP_JOB, WHATSAPP_QUEUE } from '../queue/queue.constants.js';
import { WHATSAPP_PROVIDER } from '../types/whatsapp.types.js';
import type { WhatsAppJobData } from '../types/notification.types.js';
import type { WhatsAppProvider } from '../types/whatsapp.types.js';
import { maskPhone } from '../utils/phone.js';

const whatsAppJobSchema = z.object({
    campaignName: z.string().min(1),
    destination: z.string().regex(/^\+[1-9][0-9]{7,14}$/),
    userName: z.string().min(1),
    templateParams: z.array(z.string()),
});

/** Sends a queued WhatsApp template message. */
@Processor(WHATSAPP_QUEUE, { concurrency: 5 })
export class WhatsAppProcessor extends WorkerHost {
    private readonly logger = new Logger(WhatsAppProcessor.name);

    constructor(@Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsAppProvider) {
        super();
    }

    async process(job: Job<WhatsAppJobData>): Promise<void> {
        if (job.name !== SEND_WHATSAPP_JOB) throw new UnrecoverableError(`Unexpected job name: ${job.name}`);

        const parsed = whatsAppJobSchema.safeParse(job.data);
        if (!parsed.success) {
            throw new UnrecoverableError(`Invalid WhatsApp job: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`);
        }

        try {
            await this.provider.send(parsed.data);
        } catch (error) {
            throw toJobError(error);
        }
        this.logger.log(`Sent "${parsed.data.campaignName}" to ${maskPhone(parsed.data.destination)} (job ${job.id})`);
    }

    @OnWorkerEvent('failed')
    onFailed(job: Job<WhatsAppJobData> | undefined, error: Error): void {
        if (!job) return;
        const attempts = job.opts.attempts ?? 1;
        const finished = job.attemptsMade >= attempts || error instanceof UnrecoverableError;
        this.logger.warn(
            `WhatsApp job ${job.id} ("${job.data.campaignName}" to ${maskPhone(job.data.destination)}) failed, attempt ${job.attemptsMade}/${attempts}: ${error.message}${finished ? ' - giving up' : ''}`,
        );
    }
}
