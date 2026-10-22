import { Injectable } from '@nestjs/common';
import { ModelService, expireOverdueTests } from '@app/model';
import { Prisma, TestStatus } from '@app/prisma';
import type { NewSchedule, ScheduleFilter, ScheduleRecord, ScheduleWindow } from './types/test-schedule.types.js';

export const scheduleSelect = {
    id: true,
    level: true,
    durationMinutes: true,
    startsAt: true,
    endsAt: true,
    status: true,
    invitationQueuedAt: true,
    createdAt: true,
    candidate: { select: { id: true, fullName: true, email: true, phone: true } },
    invitedBy: { select: { id: true, fullName: true } },
} as const satisfies Prisma.TestScheduleSelect;

/** Thrown by create() when the candidate already has a test, so callers never need Prisma error codes. */
export class CandidateAlreadyScheduledError extends Error {
    constructor(readonly email: string) {
        super(`${email} already has a test scheduled`);
        this.name = 'CandidateAlreadyScheduledError';
    }
}

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
     * Books the test, creating the candidate first if this email is new. A candidate who is
     * already known but has no test yet is reused as they are. One test per candidate.
     */
    async create(input: NewSchedule): Promise<ScheduleRecord> {
        const { candidate } = input;
        try {
            return await this.db.$transaction(async (tx) => {
                const existing = await tx.candidate.findUnique({
                    where: { email: candidate.email },
                    select: { id: true, testSchedule: { select: { id: true } } },
                });
                if (existing?.testSchedule) throw new CandidateAlreadyScheduledError(candidate.email);

                const candidateId =
                    existing?.id ??
                    (await tx.candidate.create({ data: candidate, select: { id: true } })).id;

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
        } catch (error) {
            // Two requests for the same new email can both pass the check above; the unique indexes catch the loser.
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                throw new CandidateAlreadyScheduledError(candidate.email);
            }
            throw error;
        }
    }

    markInvitationQueued(id: number, at: Date): Promise<ScheduleRecord> {
        return this.db.testSchedule.update({
            where: { id },
            data: { invitationQueuedAt: at },
            select: scheduleSelect,
        });
    }

    /**
     * Moves the window and puts the test back to INVITED with no invitation recorded, so the
     * candidate is emailed the new time. Only tests in one of `movableFrom` move, checked in the
     * same statement so a test that starts a moment later is never touched. Null means it didn't move.
     */
    async reschedule(id: number, window: ScheduleWindow, movableFrom: readonly TestStatus[]): Promise<ScheduleRecord | null> {
        const { count } = await this.db.testSchedule.updateMany({
            where: { id, status: { in: [...movableFrom] } },
            data: { startsAt: window.startsAt, endsAt: window.endsAt, status: TestStatus.INVITED, invitationQueuedAt: null },
        });
        return count === 0 ? null : this.findById(id);
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
