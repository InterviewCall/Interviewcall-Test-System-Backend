import { Injectable } from '@nestjs/common';
import { ModelService } from '@app/model';
import type { ReportSource } from './build-report.js';

@Injectable()
export class ReportsRepository {
    constructor(private readonly db: ModelService) {}

    /** The schedule's owner, or null when there is no such test. Used to decide who may open the report. */
    findOwner(scheduleId: number) {
        return this.db.testSchedule.findUnique({ where: { id: scheduleId }, select: { invitedById: true } });
    }

    /** Everything one report needs, or null while the test has not been submitted. */
    async load(scheduleId: number): Promise<ReportSource | null> {
        const schedule = await this.db.testSchedule.findUnique({
            where: { id: scheduleId },
            select: {
                id: true,
                level: true,
                candidate: { select: { fullName: true, email: true, phone: true } },
                invitedBy: { select: { fullName: true } },
                attempt: {
                    select: {
                        startedAt: true,
                        submittedAt: true,
                        submitReason: true,
                        workExperienceYears: true,
                        questionOrder: true,
                        answers: { select: { questionVersionId: true, selectedOptionId: true, isCorrect: true, marksAwarded: true } },
                        result: { select: { totalMarks: true, obtainedMarks: true, percentage: true, passed: true } },
                        templateVersion: {
                            select: {
                                version: true,
                                durationMinutes: true,
                                passPercent: true,
                                template: { select: { name: true } },
                                sections: {
                                    where: { scored: true },
                                    orderBy: { position: 'asc' },
                                    select: {
                                        topic: { select: { name: true } },
                                        questions: { select: { questionVersionId: true } },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });

        const attempt = schedule?.attempt;
        if (!schedule || !attempt || !attempt.submittedAt || !attempt.submitReason || !attempt.result) return null;

        const questionOrder = attempt.questionOrder as number[];
        const questions = await this.db.questionVersion.findMany({
            where: { id: { in: questionOrder } },
            select: {
                id: true,
                title: true,
                statementMd: true,
                codeStubs: true,
                marks: true,
                options: { select: { id: true, textMd: true, isCorrect: true, position: true } },
            },
        });

        const template = attempt.templateVersion;
        return {
            scheduleId: schedule.id,
            level: schedule.level,
            advisor: schedule.invitedBy.fullName,
            candidate: schedule.candidate,
            attempt: {
                startedAt: attempt.startedAt,
                submittedAt: attempt.submittedAt,
                submitReason: attempt.submitReason,
                workExperienceYears: attempt.workExperienceYears,
                questionOrder,
                answers: attempt.answers,
                template: {
                    name: template.template.name,
                    version: template.version,
                    durationMinutes: template.durationMinutes,
                    passPercent: template.passPercent,
                    sections: template.sections.map((section) => ({
                        topic: section.topic.name,
                        questionVersionIds: section.questions.map((question) => question.questionVersionId),
                    })),
                },
            },
            result: { ...attempt.result, percentage: Number(attempt.result.percentage) },
            questions,
        };
    }
}
