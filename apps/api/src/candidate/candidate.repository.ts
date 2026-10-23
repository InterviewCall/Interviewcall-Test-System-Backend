import { Injectable } from '@nestjs/common';
import { ModelService } from '@app/model';
import { Prisma, PublishStatus, TestLevel, TestStatus } from '@app/prisma';

const scheduleForSession = {
    id: true,
    status: true,
    level: true,
    durationMinutes: true,
    startsAt: true,
    endsAt: true,
    candidate: { select: { fullName: true, email: true } },
    attempt: { select: { submittedAt: true } },
} as const satisfies Prisma.TestScheduleSelect;

export type ScheduleForSession = Prisma.TestScheduleGetPayload<{ select: typeof scheduleForSession }>;

const attemptWithQuestions = {
    id: true,
    startedAt: true,
    deadlineAt: true,
    submittedAt: true,
    submitReason: true,
    questionOrder: true,
    templateVersion: {
        select: {
            sections: {
                orderBy: { position: 'asc' },
                select: { topic: { select: { name: true } }, questions: { select: { questionVersionId: true } } },
            },
        },
    },
    answers: { select: { questionVersionId: true, selectedOptionId: true } },
} as const satisfies Prisma.AttemptSelect;

export type AttemptRecord = Prisma.AttemptGetPayload<{ select: typeof attemptWithQuestions }>;

export class AttemptAlreadyStartedError extends Error {
    constructor() {
        super('Attempt already started');
    }
}

export class TestNotStartableError extends Error {
    constructor() {
        super('Test is not in a startable state');
    }
}

@Injectable()
export class CandidateRepository {
    constructor(private readonly db: ModelService) {}

    /** For shared model functions that run their own transaction, such as submitting. */
    get model(): ModelService {
        return this.db;
    }

    findScheduleByTokenHash(tokenHash: string) {
        return this.db.testSchedule.findUnique({ where: { inviteTokenHash: tokenHash }, select: scheduleForSession });
    }

    createSession(data: { testScheduleId: number; tokenHash: string; ip: string | null; userAgent: string | null; expiresAt: Date }) {
        return this.db.candidateSession.create({ data, select: { id: true } });
    }

    async findSession(tokenHash: string) {
        const session = await this.db.candidateSession.findUnique({
            where: { tokenHash },
            select: { id: true, expiresAt: true, revokedAt: true, testSchedule: { select: scheduleForSession } },
        });
        return session;
    }

    revokeSession(id: number) {
        return this.db.candidateSession.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
    }

    findScheduleById(id: number) {
        return this.db.testSchedule.findUnique({ where: { id }, select: scheduleForSession });
    }

    /** The newest published test for a level. Null if staff have not published one. */
    findPublishedTemplate(level: TestLevel) {
        return this.db.templateVersion.findFirst({
            where: { status: PublishStatus.PUBLISHED, template: { level } },
            orderBy: { version: 'desc' },
            select: {
                id: true,
                instructionsMd: true,
                sections: {
                    orderBy: { position: 'asc' },
                    select: {
                        topic: { select: { name: true } },
                        questions: { orderBy: { position: 'asc' }, select: { questionVersionId: true } },
                    },
                },
            },
        });
    }

    /**
     * Creates the attempt and moves the test to IN_PROGRESS together, only if the test is still INVITED.
     * Two starts at once: the second finds the attempt already there (or the status already moved).
     */
    async createAttempt(data: {
        scheduleId: number;
        templateVersionId: number;
        startedAt: Date;
        deadlineAt: Date;
        workExperienceYears: number;
        questionOrder: number[];
        ip: string | null;
        userAgent: string | null;
    }): Promise<void> {
        try {
            await this.db.$transaction(async (tx) => {
                const moved = await tx.testSchedule.updateMany({
                    where: { id: data.scheduleId, status: TestStatus.INVITED },
                    data: { status: TestStatus.IN_PROGRESS },
                });
                if (moved.count === 0) throw new TestNotStartableError();
                await tx.attempt.create({
                    data: {
                        testScheduleId: data.scheduleId,
                        templateVersionId: data.templateVersionId,
                        startedAt: data.startedAt,
                        deadlineAt: data.deadlineAt,
                        declaredAt: data.startedAt,
                        workExperienceYears: data.workExperienceYears,
                        questionOrder: data.questionOrder,
                        ip: data.ip,
                        userAgent: data.userAgent,
                    },
                });
            });
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                throw new AttemptAlreadyStartedError();
            }
            throw error;
        }
    }

    findAttempt(scheduleId: number): Promise<AttemptRecord | null> {
        return this.db.attempt.findUnique({ where: { testScheduleId: scheduleId }, select: attemptWithQuestions });
    }

    findAttemptById(id: number): Promise<AttemptRecord | null> {
        return this.db.attempt.findUnique({ where: { id }, select: attemptWithQuestions });
    }

    findQuestionVersions(ids: number[]) {
        return this.db.questionVersion.findMany({
            where: { id: { in: ids } },
            select: {
                id: true,
                title: true,
                statementMd: true,
                codeStubs: true,
                options: { orderBy: { position: 'asc' }, select: { id: true, textMd: true } },
            },
        });
    }

    /**
     * Saves one answer. Touching the attempt row first makes saving and submitting take turns, and
     * the update only matches an open attempt: false means it was submitted before this save.
     */
    async saveAnswer(attemptId: number, questionVersionId: number, optionId: number | null, now: Date): Promise<boolean> {
        return this.db.$transaction(async (tx) => {
            const open = await tx.attempt.updateMany({
                where: { id: attemptId, submittedAt: null },
                data: { lastSavedAt: now },
            });
            if (open.count === 0) return false;
            await tx.attemptAnswer.upsert({
                where: { attemptId_questionVersionId: { attemptId, questionVersionId } },
                create: { attemptId, questionVersionId, selectedOptionId: optionId, answeredAt: now },
                update: { selectedOptionId: optionId, answeredAt: now },
            });
            return true;
        });
    }

    async optionBelongsToQuestion(optionId: number, questionVersionId: number): Promise<boolean> {
        const count = await this.db.questionOption.count({ where: { id: optionId, questionVersionId } });
        return count > 0;
    }

    findSubmittedAttemptId(scheduleId: number) {
        return this.db.attempt.findFirst({ where: { testScheduleId: scheduleId, submittedAt: { not: null } }, select: { id: true } });
    }

    async saveFeedback(attemptId: number, rating: number, comment: string | undefined): Promise<void> {
        try {
            await this.db.feedback.create({ data: { attemptId, rating, comment: comment || null } });
        } catch (error) {
            // One piece of feedback per attempt. Sending it twice is not an error.
            if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
        }
    }
}

