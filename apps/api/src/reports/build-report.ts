import type { SubmitReason, TestLevel } from '@app/prisma';
import type { AnswerStatus, CodeStub, ReportTopic, TestReport } from './types/report.types.js';

/** What the repository loads. Plain data, so the builder is a pure function. */
export interface ReportSource {
    scheduleId: number;
    level: TestLevel;
    advisor: string;
    candidate: { fullName: string; email: string; phone: string | null };
    attempt: {
        startedAt: Date;
        submittedAt: Date;
        submitReason: SubmitReason;
        workExperienceYears: number;
        /** Question version ids in the order the candidate saw them. */
        questionOrder: number[];
        answers: { questionVersionId: number; selectedOptionId: number | null; isCorrect: boolean | null; marksAwarded: number | null }[];
        template: {
            name: string;
            version: number;
            durationMinutes: number;
            passPercent: number;
            /** Only the sections that count towards the score. */
            sections: { topic: string; questionVersionIds: number[] }[];
        };
    };
    result: { totalMarks: number; obtainedMarks: number; percentage: number; passed: boolean };
    questions: {
        id: number;
        title: string;
        statementMd: string;
        codeStubs: unknown;
        marks: number;
        options: { id: number; textMd: string; isCorrect: boolean; position: number }[];
    }[];
}

/** The stored JSON, trusted no further than its shape: entries without code are dropped, and none left means null. */
function asCodeStubs(value: unknown): CodeStub[] | null {
    if (!Array.isArray(value)) return null;
    const stubs: CodeStub[] = [];
    for (const entry of value as unknown[]) {
        if (typeof entry !== 'object' || entry === null) continue;
        const { language, label, code } = entry as Record<string, unknown>;
        if (typeof code !== 'string' || code.trim() === '') continue;
        const lang = typeof language === 'string' && language !== '' ? language : 'code';
        stubs.push({ language: lang, label: typeof label === 'string' && label !== '' ? label : lang, code });
    }
    return stubs.length > 0 ? stubs : null;
}

export function buildReport(source: ReportSource): TestReport {
    const answers = new Map(source.attempt.answers.map((answer) => [answer.questionVersionId, answer]));
    const questions = new Map(source.questions.map((question) => [question.id, question]));
    const topicOf = new Map<number, string>();
    const topicOrder: string[] = [];
    for (const section of source.attempt.template.sections) {
        topicOrder.push(section.topic);
        for (const id of section.questionVersionIds) topicOf.set(id, section.topic);
    }

    const byTopic = new Map<string, ReportTopic>(
        topicOrder.map((topic) => [
            topic,
            { topic, questions: 0, answered: 0, correct: 0, totalMarks: 0, obtainedMarks: 0, items: [] },
        ]),
    );

    // The order the candidate saw, so the review reads like the test did.
    for (const id of source.attempt.questionOrder) {
        const topic = byTopic.get(topicOf.get(id) ?? '');
        const question = questions.get(id);
        if (!topic || !question) continue; // A survey question: not scored, not in the report.

        const answer = answers.get(id);
        const selected = answer?.selectedOptionId ?? null;
        const status: AnswerStatus = selected === null ? 'blank' : answer?.isCorrect ? 'correct' : 'wrong';
        const marks = answer?.marksAwarded ?? 0;

        topic.questions += 1;
        topic.totalMarks += question.marks;
        topic.obtainedMarks += marks;
        if (selected !== null) topic.answered += 1;
        if (status === 'correct') topic.correct += 1;

        topic.items.push({
            questionVersionId: id,
            code: question.title,
            number: topic.items.length + 1,
            status,
            marks,
            totalMarks: question.marks,
            statementMd: question.statementMd,
            codeStubs: asCodeStubs(question.codeStubs),
            options: [...question.options]
                .sort((a, b) => a.position - b.position)
                .map((option) => ({ id: option.id, textMd: option.textMd, isCorrect: option.isCorrect, chosen: option.id === selected })),
        });
    }

    return {
        scheduleId: source.scheduleId,
        level: source.level,
        candidate: { ...source.candidate, workExperienceYears: source.attempt.workExperienceYears },
        advisor: source.advisor,
        template: {
            name: source.attempt.template.name,
            version: source.attempt.template.version,
            durationMinutes: source.attempt.template.durationMinutes,
            passPercent: source.attempt.template.passPercent,
        },
        attempt: {
            startedAt: source.attempt.startedAt,
            submittedAt: source.attempt.submittedAt,
            submitReason: source.attempt.submitReason,
        },
        result: source.result,
        topics: [...byTopic.values()].filter((topic) => topic.questions > 0),
    };
}
