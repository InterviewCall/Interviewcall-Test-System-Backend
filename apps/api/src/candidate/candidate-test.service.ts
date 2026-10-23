import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { ANSWER_GRACE_MS, submitAttempt } from '@app/model';
import { SubmitReason, TestStatus } from '@app/prisma';
import { latestStartAt } from '../test-schedules/test-levels.js';
import { AttemptAlreadyStartedError, CandidateRepository, TestNotStartableError } from './candidate.repository.js';
import type { AttemptRecord } from './candidate.repository.js';
import type { FeedbackInput, SaveAnswerInput, StartAttemptInput } from './candidate.schemas.js';
import type {
    AttemptSectionView,
    AttemptView,
    CandidateContext,
    CandidateTestView,
    TestState,
} from './types/candidate.types.js';

function timeUp(): ConflictException {
    return new ConflictException({ statusCode: 409, code: 'TIME_UP', message: 'Time is up. Your answers have been submitted.' });
}

function shuffled<T>(items: T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
    }
    return copy;
}

@Injectable()
export class CandidateTestService {
    constructor(private readonly repo: CandidateRepository) {}

    /** Where the candidate is, and what they are about to take. */
    async getTest(who: CandidateContext): Promise<CandidateTestView> {
        const now = new Date();
        const template = await this.repo.findPublishedTemplate(who.level);
        const latest = latestStartAt(who.endsAt, who.durationMinutes);

        let state: TestState;
        if (who.status === TestStatus.SUBMITTED) state = 'SUBMITTED';
        else if (who.status === TestStatus.IN_PROGRESS) state = await this.settledState(who, now);
        else state = now < who.startsAt ? 'NOT_OPEN' : 'READY';

        return {
            state,
            candidate: { fullName: who.fullName },
            level: who.level,
            durationMinutes: who.durationMinutes,
            startsAt: who.startsAt,
            endsAt: who.endsAt,
            latestStartAt: latest,
            serverTime: now,
            test: template
                ? {
                      questionCount: template.sections.reduce((sum, s) => sum + s.questions.length, 0),
                      sections: template.sections.map((s) => ({ topic: s.topic.name, questions: s.questions.length })),
                      instructionsMd: template.instructionsMd,
                  }
                : null,
        };
    }

    async startAttempt(who: CandidateContext, input: StartAttemptInput, ip: string | null, userAgent: string | null): Promise<AttemptView> {
        const now = new Date();
        const existing = await this.repo.findAttempt(who.scheduleId);
        if (existing) return this.view(await this.settle(existing, now), who, now); // Resume: same attempt, same clock.

        if (who.status !== TestStatus.INVITED) throw new ConflictException('This test cannot be started');
        if (now < who.startsAt) throw new ConflictException({ statusCode: 409, code: 'NOT_OPEN_YET', message: 'The test has not opened yet' });
        if (now > latestStartAt(who.endsAt, who.durationMinutes)) {
            throw new ConflictException({ statusCode: 409, code: 'TEST_CLOSED', message: 'The window to start this test has closed' });
        }

        const template = await this.repo.findPublishedTemplate(who.level);
        if (!template || template.sections.every((s) => s.questions.length === 0)) {
            throw new ConflictException({ statusCode: 409, code: 'NO_TEST', message: 'No test is available for your level right now' });
        }
        // Questions are shuffled inside each section, once, and the order is kept for the whole attempt.
        const questionOrder = template.sections.flatMap((s) => shuffled(s.questions.map((q) => q.questionVersionId)));

        try {
            await this.repo.createAttempt({
                scheduleId: who.scheduleId,
                templateVersionId: template.id,
                startedAt: now,
                deadlineAt: new Date(now.getTime() + who.durationMinutes * 60_000),
                workExperienceYears: input.workExperienceYears,
                questionOrder,
                ip,
                userAgent,
            });
        } catch (error) {
            if (!(error instanceof AttemptAlreadyStartedError || error instanceof TestNotStartableError)) throw error;
            // Another tab started it a moment ago. Fall through and return that attempt.
        }

        const attempt = await this.repo.findAttempt(who.scheduleId);
        if (!attempt) throw new ConflictException('This test cannot be started');
        return this.view(attempt, who, now);
    }

    async getAttempt(who: CandidateContext): Promise<AttemptView> {
        const now = new Date();
        const attempt = await this.repo.findAttempt(who.scheduleId);
        if (!attempt) throw new NotFoundException({ statusCode: 404, code: 'NOT_STARTED', message: 'You have not started the test yet' });
        return this.view(await this.settle(attempt, now), who, now);
    }

    /** Saves (or clears) the answer to one question. Safe to repeat. */
    async saveAnswer(who: CandidateContext, questionVersionId: number, input: SaveAnswerInput): Promise<{ savedAt: Date }> {
        const now = new Date();
        const attempt = await this.repo.findAttempt(who.scheduleId);
        if (!attempt) throw new NotFoundException({ statusCode: 404, code: 'NOT_STARTED', message: 'You have not started the test yet' });
        if (attempt.submittedAt) throw new ConflictException({ statusCode: 409, code: 'ALREADY_SUBMITTED', message: 'This test has already been submitted' });
        if (now.getTime() > attempt.deadlineAt.getTime() + ANSWER_GRACE_MS) {
            await submitAttempt(this.repo.model, attempt.id, SubmitReason.TIMEOUT, now);
            throw timeUp();
        }
        if (!(attempt.questionOrder as number[]).includes(questionVersionId)) throw new NotFoundException('That question is not part of your test');
        if (input.optionId !== null && !(await this.repo.optionBelongsToQuestion(input.optionId, questionVersionId))) {
            throw new BadRequestException('That option does not belong to this question');
        }

        const saved = await this.repo.saveAnswer(attempt.id, questionVersionId, input.optionId, now);
        if (!saved) throw new ConflictException({ statusCode: 409, code: 'ALREADY_SUBMITTED', message: 'This test has already been submitted' });
        return { savedAt: now };
    }

    /** Ends the test. Pressing it twice, or after time ran out, is fine: the first submit wins. */
    async submit(who: CandidateContext): Promise<{ status: 'SUBMITTED'; submittedAt: Date }> {
        const now = new Date();
        const attempt = await this.repo.findAttempt(who.scheduleId);
        if (!attempt) throw new NotFoundException({ statusCode: 404, code: 'NOT_STARTED', message: 'You have not started the test yet' });

        if (!attempt.submittedAt) {
            const late = now.getTime() > attempt.deadlineAt.getTime() + ANSWER_GRACE_MS;
            await submitAttempt(this.repo.model, attempt.id, late ? SubmitReason.TIMEOUT : SubmitReason.CANDIDATE, now);
        }
        const done = await this.repo.findAttempt(who.scheduleId);
        return { status: 'SUBMITTED', submittedAt: (done?.submittedAt ?? now) };
    }

    async sendFeedback(who: CandidateContext, input: FeedbackInput): Promise<void> {
        const attempt = await this.repo.findSubmittedAttemptId(who.scheduleId);
        if (!attempt) throw new ConflictException('Submit your test before sending feedback');
        await this.repo.saveFeedback(attempt.id, input.rating, input.comment);
    }

    /** An open attempt past its deadline plus grace is submitted now, so a returning candidate never sees a dead clock. */
    private async settle(attempt: AttemptRecord, now: Date): Promise<AttemptRecord> {
        if (attempt.submittedAt || now.getTime() <= attempt.deadlineAt.getTime() + ANSWER_GRACE_MS) return attempt;
        await submitAttempt(this.repo.model, attempt.id, SubmitReason.TIMEOUT, now);
        return (await this.repo.findAttemptById(attempt.id)) ?? attempt;
    }

    private async settledState(who: CandidateContext, now: Date): Promise<TestState> {
        const attempt = await this.repo.findAttempt(who.scheduleId);
        if (!attempt) return 'READY';
        return (await this.settle(attempt, now)).submittedAt ? 'SUBMITTED' : 'IN_PROGRESS';
    }

    private async view(attempt: AttemptRecord, _who: CandidateContext, now: Date): Promise<AttemptView> {
        const base = {
            startedAt: attempt.startedAt,
            deadlineAt: attempt.deadlineAt,
            submittedAt: attempt.submittedAt,
            serverTime: now,
        };
        if (attempt.submittedAt) return { ...base, status: 'SUBMITTED', sections: [] };

        const order = attempt.questionOrder as number[];
        const versions = new Map((await this.repo.findQuestionVersions(order)).map((v) => [v.id, v]));
        const selected = new Map(attempt.answers.map((a) => [a.questionVersionId, a.selectedOptionId]));
        const sectionOf = new Map<number, string>();
        for (const section of attempt.templateVersion.sections) {
            for (const q of section.questions) sectionOf.set(q.questionVersionId, section.topic.name);
        }

        // Keep the saved order, grouping consecutive questions of the same topic into one section.
        const sections: AttemptSectionView[] = [];
        for (const id of order) {
            const version = versions.get(id);
            if (!version) continue;
            const topic = sectionOf.get(id) ?? '';
            let section = sections[sections.length - 1];
            if (!section || section.topic !== topic) {
                section = { topic, questions: [] };
                sections.push(section);
            }
            section.questions.push({
                questionVersionId: id,
                title: version.title,
                statementMd: version.statementMd,
                codeStubs: version.codeStubs,
                options: version.options,
                selectedOptionId: selected.get(id) ?? null,
            });
        }
        return { ...base, status: 'IN_PROGRESS', sections };
    }
}
