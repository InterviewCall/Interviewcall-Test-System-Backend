import { Module } from '@nestjs/common';
import { TestSchedulesModule } from '../test-schedules/test-schedules.module.js';
import { MailEventsController } from './mail-events.controller.js';
import { MailEventsService } from './mail-events.service.js';
import { SNS_FETCH, SnsVerifier } from './sns-verifier.js';
import type { SnsFetch } from './sns-verifier.js';

const fetchOverHttps: SnsFetch = async (url) => {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
};

@Module({
    imports: [TestSchedulesModule],
    controllers: [MailEventsController],
    providers: [MailEventsService, SnsVerifier, { provide: SNS_FETCH, useValue: fetchOverHttps }],
})
export class MailEventsModule {}
