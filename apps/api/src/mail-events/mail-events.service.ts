import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { APP_CONFIG } from '../config/app.config.js';
import type { AppConfig } from '../config/types/app-config.types.js';
import { TestScheduleRepository } from '../test-schedules/test-schedule.repository.js';
import { interpretSesEvent } from './ses-event.js';
import { InvalidSnsMessageError, isSnsUrl, SNS_FETCH, SnsVerifier, snsMessageSchema } from './sns-verifier.js';
import type { SnsFetch } from './sns-verifier.js';

/**
 * Receives what SES reports about each email (sent, delivered, bounced, ...) through an SNS topic and
 * records it on the test the email was for.
 */
@Injectable()
export class MailEventsService {
    private readonly logger = new Logger(MailEventsService.name);

    constructor(
        @Inject(APP_CONFIG) private readonly config: AppConfig,
        private readonly verifier: SnsVerifier,
        private readonly schedules: TestScheduleRepository,
        @Inject(SNS_FETCH) private readonly fetchText: SnsFetch,
    ) {}

    async handle(body: unknown): Promise<void> {
        const topicArn = this.config.mailEvents.topicArn;
        // Not set up: behave as though the address doesn't exist.
        if (!topicArn) throw new NotFoundException();

        const message = snsMessageSchema.safeParse(typeof body === 'string' ? parseJson(body) : body);
        if (!message.success) throw new BadRequestException('Not an SNS message');
        const sns = message.data;

        // Only our own topic may report here. Checked first, so a stranger's message never costs a certificate fetch.
        if (sns.TopicArn !== topicArn) throw new ForbiddenException('Unknown topic');
        try {
            await this.verifier.verify(sns);
        } catch (error) {
            if (error instanceof InvalidSnsMessageError) {
                this.logger.warn(`Refused an SNS message: ${error.message}`);
                throw new ForbiddenException('Invalid signature');
            }
            throw error;
        }

        if (sns.Type === 'SubscriptionConfirmation') {
            if (!sns.SubscribeURL || !isSnsUrl(sns.SubscribeURL)) throw new ForbiddenException('Unexpected confirmation address');
            await this.fetchText(sns.SubscribeURL);
            this.logger.log(`Confirmed the SNS subscription to ${sns.TopicArn}`);
            return;
        }
        if (sns.Type === 'UnsubscribeConfirmation') {
            this.logger.warn(`SNS says the subscription to ${sns.TopicArn} was removed: delivery reports will stop arriving`);
            return;
        }

        const update = interpretSesEvent(sns.Message);
        if (!update) return;
        const applied = await this.schedules.recordMailEvent(update.ref, update.status, update.detail, update.at);
        this.logger.log(`Mail ${update.ref}: ${update.status}${applied ? '' : ' (no change: unknown email or already further along)'}`);
    }
}

function parseJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}
