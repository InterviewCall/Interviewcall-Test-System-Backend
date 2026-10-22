import { Module } from '@nestjs/common';
import { NotificationsService } from '@app/notifications';
import type { StaffAccountReadyInput } from '@app/notifications';

/** Records what the API asked to send, so e2e tests never need Redis. */
export class FakeNotificationsService {
    staffEmails: StaffAccountReadyInput[] = [];
    queueIsUp = true;

    sendStaffAccountReady(input: StaffAccountReadyInput): Promise<boolean> {
        if (!this.queueIsUp) return Promise.resolve(false);
        this.staffEmails.push(input);
        return Promise.resolve(true);
    }

    sendWhatsApp(): Promise<boolean> {
        return Promise.resolve(this.queueIsUp);
    }
}

export const fakeNotifications = new FakeNotificationsService();

@Module({
    providers: [{ provide: NotificationsService, useValue: fakeNotifications }],
    exports: [NotificationsService],
})
export class FakeNotificationsModule {}
