import { Injectable } from '@nestjs/common';
import { ModelService, expireOverdueTests } from '@app/model';
import { MailDeliveryStatus, Prisma, TestStatus } from '@app/prisma';
import { statusesBelow } from './mail-delivery.js';
import type { NewSchedule, ScheduleFilter, ScheduleRecord, ScheduleWindow } from './types/test-schedule.types.js';

export const scheduleSelect = {
    id: true,
    level: true,
    durationMinutes: true,
    startsAt: true,
    endsAt: true,
    status: true,
    invitationQueuedAt: true,
    invitationMailStatus: true,
    invitationMailDetail: true,
    invitationMailUpdatedAt: true,
    createdAt: true,
    candidate: { select: { id: true, fullName: true, email: true, phone: true } },
    invitedBy: { select: { id: true, fullName: true } },
} as const satisfies Prisma.TestScheduleSelect;

@Injectable()
export class TestScheduleRepository {
    constructor(private readonly db: ModelService) {}

    /** Marks tests nobody started in time as EXPIRED, so a read never shows a closed test as still waiting. */
    expireOverdue(now: Date = new Date()): Promise<number> {
        return expireOverdueTests(this.db, now);
    }

    findById(id: number): Promise<ScheduleRecord | null> {
        return this.db.testSchedule.findUnique({ where: { id }, select: scheduleSelect });
    }

    /**
     * Books the test, creating the candidate first if this email is new. A candidate who is already
     * known is reused as they are, except that a phone number is filled in when they had none (older
     * candidates were saved without one). A candidate can have any number of tests, including a new
     * one after an earlier one was submitted.
     */
    async create(input: NewSchedule): Promise<ScheduleRecord> {
        try {
            return await this.book(input);
        } catch (error) {
            // Two requests for the same new email can both find no candidate; the unique email index stops
            // the second one. Going round again finds the candidate the first request made.
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return this.book(input);
            throw error;
        }
    }

    private book(input: NewSchedule): Promise<ScheduleRecord> {
        const { candidate } = input;
        return this.db.$transaction(async (tx) => {
            const existing = await tx.candidate.findUnique({
                where: { email: candidate.email },
                select: { id: true, phone: true },
            });
            if (existing && !existing.phone) {
                await tx.candidate.update({ where: { id: existing.id }, data: { phone: candidate.phone } });
            }
            const candidateId =
                existing?.id ?? (await tx.candidate.create({ data: candidate, select: { id: true } })).id;

            return tx.testSchedule.create({
                data: {
                    candidateId,
                    invitedById: input.invitedById,
                    level: input.level,
                    durationMinutes: input.durationMinutes,
                    startsAt: input.startsAt,
                    endsAt: input.endsAt,
                },
                select: scheduleSelect,
            });
        });
    }

    /**
     * Records that the email was put on the queue. The status becomes QUEUED only if no report from
     * SES has come in yet, so a fast "sent" or "delivered" is never knocked back.
     */
    async markInvitationQueued(id: number, mailRef: string, at: Date): Promise<ScheduleRecord> {
        await this.db.testSchedule.updateMany({
            where: { id, invitationMailRef: mailRef, invitationMailStatus: null },
            data: { invitationMailStatus: MailDeliveryStatus.QUEUED, invitationMailUpdatedAt: at },
        });
        return this.db.testSchedule.update({
            where: { id },
            data: { invitationQueuedAt: at },
            select: scheduleSelect,
        });
    }

    /**
     * Gets a test ready for a new email: replaces the secret in the candidate's start link (the previous
     * link stops working at once) and the reference that follows the email's delivery, and forgets the
     * old email's status. Done before the email is queued, so no report can arrive for a reference that
     * isn't saved yet.
     */
    async startInvitation(id: number, tokenHash: string, mailRef: string): Promise<void> {
        await this.db.testSchedule.update({
            where: { id },
            data: {
                inviteTokenHash: tokenHash,
                invitationMailRef: mailRef,
                invitationMailStatus: null,
                invitationMailDetail: null,
                invitationMailUpdatedAt: null,
            },
            select: { id: true },
        });
    }

    /**
     * Swaps the secret in the candidate's start link without sending anything. The previous link stops
     * working at once, and so does any browser already signed in with it. Done in one statement that also
     * checks the test is still waiting to be started, so a test that began a moment earlier is never touched.
     * Returns whether the secret was replaced.
     */
    async replaceLink(id: number, tokenHash: string): Promise<boolean> {
        const { count } = await this.db.testSchedule.updateMany({
            where: { id, status: TestStatus.INVITED },
            data: { inviteTokenHash: tokenHash },
        });
        if (count === 0) return false;
        await this.db.candidateSession.updateMany({
            where: { testScheduleId: id, revokedAt: null },
            data: { revokedAt: new Date() },
        });
        return true;
    }

    /**
     * Applies a delivery report from SES to the test whose email carried `mailRef`. It lands only when it
     * moves the email forward (see mail-delivery.ts), so reports may arrive in any order or twice.
     * Returns whether a test was updated.
     */
    async recordMailEvent(mailRef: string, status: MailDeliveryStatus, detail: string | null, at: Date): Promise<boolean> {
        const { count } = await this.db.testSchedule.updateMany({
            where: {
                invitationMailRef: mailRef,
                OR: [{ invitationMailStatus: null }, { invitationMailStatus: { in: statusesBelow(status) } }],
            },
            data: { invitationMailStatus: status, invitationMailDetail: detail, invitationMailUpdatedAt: at },
        });
        return count > 0;
    }

    /**
     * Moves the window and puts the test back to INVITED with no invitation recorded, so the
     * candidate is emailed the new time. Only tests in one of `movableFrom` move, checked in the
     * same statement so a test that starts a moment later is never touched. Null means it didn't move.
     */
    async reschedule(id: number, window: ScheduleWindow, movableFrom: readonly TestStatus[]): Promise<ScheduleRecord | null> {
        const { count } = await this.db.testSchedule.updateMany({
            where: { id, status: { in: [...movableFrom] } },
            // The old link and any browser already signed in with it are finished; the new email brings a new link.
            data: {
                startsAt: window.startsAt,
                endsAt: window.endsAt,
                status: TestStatus.INVITED,
                invitationQueuedAt: null,
                inviteTokenHash: null,
                invitationMailRef: null,
                invitationMailStatus: null,
                invitationMailDetail: null,
                invitationMailUpdatedAt: null,
            },
        });
        if (count === 0) return null;
        await this.db.candidateSession.updateMany({
            where: { testScheduleId: id, revokedAt: null },
            data: { revokedAt: new Date() },
        });
        return this.findById(id);
    }

    async findPage(
        filter: ScheduleFilter,
        paging: { skip: number; take: number },
    ): Promise<{ items: ScheduleRecord[]; total: number }> {
        const where: Prisma.TestScheduleWhereInput = {
            ...(filter.invitedById !== undefined && { invitedById: filter.invitedById }),
            ...(filter.status && { status: filter.status }),
            ...(filter.level && { level: filter.level }),
            ...((filter.startsFrom || filter.startsTo) && {
                startsAt: {
                    ...(filter.startsFrom && { gte: filter.startsFrom }),
                    ...(filter.startsTo && { lte: filter.startsTo }),
                },
            }),
            ...(filter.q && {
                candidate: { OR: [{ fullName: { contains: filter.q } }, { email: { contains: filter.q } }] },
            }),
        };

        const [items, total] = await this.db.$transaction([
            this.db.testSchedule.findMany({
                where,
                select: scheduleSelect,
                orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
                skip: paging.skip,
                take: paging.take,
            }),
            this.db.testSchedule.count({ where }),
        ]);

        return { items, total };
    }
}
