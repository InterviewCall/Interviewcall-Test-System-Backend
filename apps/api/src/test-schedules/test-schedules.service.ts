import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationsService } from '@app/notifications';
import { TestStatus } from '@app/prisma';
import { hashToken, newSecretToken } from '../candidate/invite-token.js';
import { seesAllTests } from '../common/roles.js';
import type { AuthUser } from '../common/types/authenticated-request.types.js';
import type { Page } from '../common/types/pagination.types.js';
import { latestStartAt, MINUTE_MS, TEST_DURATION_MINUTES } from './test-levels.js';
import { TestScheduleRepository } from './test-schedule.repository.js';
import type { ScheduleRecord, ScheduledWithEmailStatus } from './types/test-schedule.types.js';
import type { ListSchedulesQuery, RescheduleTestInput, ScheduleTestInput } from './types/test-schedule-input.types.js';

/** A candidate who has not started can still be given a new time. */
const RESCHEDULABLE: readonly TestStatus[] = [TestStatus.INVITED, TestStatus.EXPIRED];

@Injectable()
export class TestSchedulesService {
    private readonly logger = new Logger(TestSchedulesService.name);

    constructor(
        private readonly schedules: TestScheduleRepository,
        private readonly notifications: NotificationsService,
    ) {}

    /** Books the test, then queues the invitation email. A failed email never undoes the booking. */
    async schedule(dto: ScheduleTestInput, actor: AuthUser): Promise<ScheduledWithEmailStatus> {
        const durationMinutes = TEST_DURATION_MINUTES[dto.level];
        this.assertCanStillStart(dto.endsAt, durationMinutes);

        const created = await this.schedules.create({
            candidate: dto.candidate,
            invitedById: actor.id,
            level: dto.level,
            durationMinutes,
            startsAt: dto.startsAt,
            endsAt: dto.endsAt,
        });
        this.logger.log(`Test ${created.id} (${created.level}) scheduled for candidate ${created.candidate.id} by user ${actor.id}`);

        return this.sendInvitation(created, 'scheduled');
    }

    async list(query: ListSchedulesQuery, actor: AuthUser): Promise<Page<ScheduleRecord>> {
        // The worker does this every minute; doing it here too keeps the list right when it is not running.
        await this.schedules.expireOverdue();
        const { items, total } = await this.schedules.findPage(
            {
                // Advisors only ever see their own; admins and managers see everyone's unless they narrow it.
                invitedById: seesAllTests(actor.role) ? query.invitedById : actor.id,
                status: query.status,
                level: query.level,
                q: query.q,
                startsFrom: query.startsFrom,
                startsTo: query.startsTo,
            },
            { skip: (query.page - 1) * query.pageSize, take: query.pageSize },
        );
        return { items, total, page: query.page, pageSize: query.pageSize };
    }

    async get(id: number, actor: AuthUser): Promise<ScheduleRecord> {
        await this.schedules.expireOverdue();
        const schedule = await this.schedules.findById(id);
        // An advisor asking for someone else's test gets the same answer as for a test that doesn't exist.
        if (!schedule || (!seesAllTests(actor.role) && schedule.invitedBy.id !== actor.id)) {
            throw new NotFoundException('Test not found');
        }
        return schedule;
    }

    /** Queues the invitation again, for when the first attempt could not be queued or the candidate lost it. */
    async resendInvitation(id: number, actor: AuthUser): Promise<ScheduledWithEmailStatus> {
        const schedule = await this.get(id, actor);
        if (schedule.status !== TestStatus.INVITED) {
            throw new ConflictException('This test has already been started, submitted or has expired');
        }
        this.assertCanStillStart(schedule.endsAt, schedule.durationMinutes);
        return this.sendInvitation(schedule, 'scheduled');
    }

    /**
     * Makes a fresh start link and hands it back, for passing on another way when the email isn't reaching the
     * candidate. Nothing is emailed and the link is not stored (only its hash is), so this is the one time it can
     * be seen. The previous link stops working at once, whether it was in an email or copied from here earlier.
     */
    async issueNewLink(id: number, actor: AuthUser): Promise<{ url: string }> {
        const schedule = await this.get(id, actor);
        if (schedule.status !== TestStatus.INVITED) {
            throw new ConflictException('This test has already been started, submitted or has expired');
        }
        this.assertCanStillStart(schedule.endsAt, schedule.durationMinutes);

        const inviteToken = newSecretToken();
        const replaced = await this.schedules.replaceLink(id, hashToken(inviteToken));
        if (!replaced) throw new ConflictException('This test has already been started, submitted or has expired');
        // The log never carries the link itself.
        this.logger.log(`Test ${id}: new start link issued by user ${actor.id}`);
        return { url: this.notifications.testStartUrl(inviteToken) };
    }

    /**
     * Moves a test to a new window and emails the candidate the new time. Allowed while the
     * candidate has not started: still invited (even if they missed the slot) or expired.
     * Once it is in progress or submitted there is nothing to move.
     */
    async reschedule(id: number, dto: RescheduleTestInput, actor: AuthUser): Promise<ScheduledWithEmailStatus> {
        const current = await this.get(id, actor);
        if (!RESCHEDULABLE.includes(current.status)) {
            throw new ConflictException('This test has already been started or submitted, so it cannot be rescheduled');
        }
        const { durationMinutes } = current;
        if ((dto.endsAt.getTime() - dto.startsAt.getTime()) / MINUTE_MS < durationMinutes) {
            throw new BadRequestException(
                `The window must be at least ${durationMinutes} minutes for the ${current.level.toLowerCase()} test`,
            );
        }
        this.assertCanStillStart(dto.endsAt, durationMinutes);

        const moved = await this.schedules.reschedule(id, dto, RESCHEDULABLE);
        if (!moved) throw new ConflictException('This test has already been started or submitted, so it cannot be rescheduled');
        this.logger.log(`Test ${id} rescheduled by user ${actor.id}`);

        return this.sendInvitation(moved, 'rescheduled');
    }

    private assertCanStillStart(endsAt: Date, durationMinutes: number): void {
        if (latestStartAt(endsAt, durationMinutes).getTime() <= Date.now()) {
            throw new BadRequestException(
                `The slot is too late: a candidate needs to start at least ${durationMinutes} minutes before it closes`,
            );
        }
    }

    private async sendInvitation(schedule: ScheduleRecord, kind: 'scheduled' | 'rescheduled'): Promise<ScheduledWithEmailStatus> {
        // A fresh secret for every email: the newest link is the only one that works.
        const inviteToken = newSecretToken();
        // Tags this email, so SES can tell us later whether it was delivered or bounced.
        const mailRef = randomUUID();
        await this.schedules.startInvitation(schedule.id, hashToken(inviteToken), mailRef);

        const send = kind === 'rescheduled' ? this.notifications.sendTestRescheduled : this.notifications.sendTestScheduled;
        const emailQueued = await send.call(this.notifications, {
            fullName: schedule.candidate.fullName,
            email: schedule.candidate.email,
            startsAt: schedule.startsAt,
            endsAt: schedule.endsAt,
            durationMinutes: schedule.durationMinutes,
            inviteToken,
            mailRef,
        });
        if (!emailQueued) return { schedule: (await this.schedules.findById(schedule.id)) ?? schedule, emailQueued };

        try {
            return { schedule: await this.schedules.markInvitationQueued(schedule.id, mailRef, new Date()), emailQueued };
        } catch (error) {
            // The email is already queued; only the bookkeeping failed. Say so rather than fail the request.
            this.logger.error(`Test ${schedule.id}: invitation queued but could not be recorded: ${String(error)}`);
            return { schedule, emailQueued };
        }
    }
}
