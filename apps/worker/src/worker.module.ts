import { Module } from '@nestjs/common';
import { ModelModule } from '@app/model';
import { NotificationsWorkerModule } from '@app/notifications/worker';
import { ExpiryModule } from './expiry/expiry.module.js';

/** Background jobs: sending queued emails and WhatsApp messages, and expiring tests nobody started. */
@Module({
    imports: [ModelModule, NotificationsWorkerModule, ExpiryModule],
})
export class WorkerModule {}
