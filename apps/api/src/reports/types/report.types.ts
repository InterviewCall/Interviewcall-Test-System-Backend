import type { SubmitReason, TestLevel } from '@app/prisma';

export type AnswerStatus = 'correct' | 'wrong' | 'blank';

export interface ReportOption {
    id: number;
    textMd: string;
    isCorrect: boolean;
    /** The option the candidate picked. */
    chosen: boolean;
}

export interface CodeStub {
    language: string;
    label: string;
    code: string;
}

export interface ReportQuestion {
    questionVersionId: number;
    /** The question's code, such as ETATA1. Shown to staff only. */
    code: string;
    /** 1-based position inside its topic, in the order the candidate saw. */
    number: number;
    status: AnswerStatus;
    marks: number;
    totalMarks: number;
    statementMd: string;
    /** The code the question refers to, one entry per language; null when it has none. */
    codeStubs: CodeStub[] | null;
    options: ReportOption[];
}

export interface ReportTopic {
    topic: string;
    questions: number;
    answered: number;
    correct: number;
    totalMarks: number;
    obtainedMarks: number;
    items: ReportQuestion[];
}

/** Everything the report page prints. Staff only: it contains the answer key. */
export interface TestReport {
    scheduleId: number;
    level: TestLevel;
    candidate: { fullName: string; email: string; phone: string | null; workExperienceYears: number };
    advisor: string;
    template: { name: string; version: number; durationMinutes: number; passPercent: number };
    attempt: { startedAt: Date; submittedAt: Date; submitReason: SubmitReason };
    result: { totalMarks: number; obtainedMarks: number; percentage: number; passed: boolean };
    topics: ReportTopic[];
}
