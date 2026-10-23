import { Prisma, SubmitReason, TestStatus } from '@app/prisma';
import type { ModelService } from '../model.service.js';
import { scoreAttempt } from './scoring.js';
import type { ScoringQuestion } from './scoring.js';

/** An answer may arrive this long after the deadline: the browser's clock and the network are never exact. */
export const ANSWER_GRACE_MS = 10_000;

export interface SubmitOutcome {
    /** False when the attempt had already been submitted by someone else. Nothing was changed. */
    submitted: boolean;
}

/**
 * Closes an attempt and scores it, in one transaction. Safe to call twice, or from the API and the
 * worker at the same moment: the first caller claims the attempt, the others see it taken and stop.
 * Saving an answer touches the same row, so an answer is either saved before the claim and counted, or refused.
 */
export async function submitAttempt(
    db: ModelService,
    attemptId: number,
    reason: SubmitReason,
    now: Date = new Date(),
): Promise<SubmitOutcome> {
    return db.$transaction(
        async (tx) => {
            const claimed = await tx.attempt.updateMany({
                where: { id: attemptId, submittedAt: null },
                data: { submittedAt: now, submitReason: reason },
            });
            if (claimed.count === 0) return { submitted: false };

            const attempt = await tx.attempt.findUniqueOrThrow({
                where: { id: attemptId },
                select: {
                    testScheduleId: true,
                    questionOrder: true,
                    templateVersion: {
                        select: {
                            passPercent: true,
                            sections: {
                                orderBy: { position: 'asc' },
                                select: {
                                    scored: true,
                                    topic: { select: { id: true, name: true } },
                                    questions: { select: { questionVersionId: true } },
                                },
                            },
                        },
                    },
                    answers: { select: { id: true, questionVersionId: true, selectedOptionId: true } },
                },
            });

            // The questions this candidate was asked, in the order they saw them.
            const asked = new Set(attempt.questionOrder as number[]);
            const sectionOf = new Map<number, { topicId: number; topic: string }>();
            for (const section of attempt.templateVersion.sections) {
                if (!section.scored) continue;
                for (const question of section.questions) {
                    if (asked.has(question.questionVersionId)) {
                        sectionOf.set(question.questionVersionId, { topicId: section.topic.id, topic: section.topic.name });
                    }
                }
            }

            const versions = await tx.questionVersion.findMany({
                where: { id: { in: [...sectionOf.keys()] } },
                select: { id: true, marks: true, options: { where: { isCorrect: true }, select: { id: true } } },
            });
            const versionById = new Map(versions.map((version) => [version.id, version]));

            const questions: ScoringQuestion[] = [];
            for (const questionVersionId of attempt.questionOrder as number[]) {
                const section = sectionOf.get(questionVersionId);
                const version = versionById.get(questionVersionId);
                const correct = version?.options[0];
                if (!section || !version || !correct || version.options.length !== 1) continue;
                questions.push({
                    questionVersionId,
                    topicId: section.topicId,
                    topic: section.topic,
                    marks: version.marks,
                    correctOptionId: correct.id,
                });
            }

            const summary = scoreAttempt(questions, attempt.answers, attempt.templateVersion.passPercent);

            const answerIds = new Map(attempt.answers.map((answer) => [answer.questionVersionId, answer.id]));
            for (const graded of summary.graded) {
                await tx.attemptAnswer.update({
                    where: { id: answerIds.get(graded.questionVersionId) as number },
                    data: { isCorrect: graded.isCorrect, marksAwarded: graded.marksAwarded },
                });
            }

            await tx.result.create({
                data: {
                    attemptId,
                    totalMarks: summary.totalMarks,
                    obtainedMarks: summary.obtainedMarks,
                    percentage: new Prisma.Decimal(summary.percentage.toFixed(2)),
                    passed: summary.passed,
                    sectionScores: summary.sections as unknown as Prisma.InputJsonValue,
                },
            });

            await tx.testSchedule.updateMany({
                where: { id: attempt.testScheduleId, status: TestStatus.IN_PROGRESS },
                data: { status: TestStatus.SUBMITTED },
            });

            return { submitted: true };
        },
        { timeout: 30_000, maxWait: 10_000 },
    );
}

/**
 * Submits every attempt still open after its deadline plus the grace period, with whatever was saved.
 * A candidate who closes the tab at zero still gets a result. Returns how many it submitted.
 */
export async function submitOverdueAttempts(db: ModelService, now: Date = new Date()): Promise<number> {
    const overdue = await db.attempt.findMany({
        where: { submittedAt: null, deadlineAt: { lte: new Date(now.getTime() - ANSWER_GRACE_MS) } },
        select: { id: true },
        take: 100,
    });

    let submitted = 0;
    for (const attempt of overdue) {
        if ((await submitAttempt(db, attempt.id, SubmitReason.TIMEOUT, now)).submitted) submitted += 1;
    }
    return submitted;
}
