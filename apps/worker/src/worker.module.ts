import { Module } from '@nestjs/common';
import { NotificationsWorkerModule } from '@app/notifications/worker';

/** Background jobs. Today that is sending queued emails and WhatsApp messages. */
@Module({
    imports: [NotificationsWorkerModule],
})
export class WorkerModule {}
