import type { Request } from 'express';
import type { TestLevel, TestStatus } from '@app/prisma';

/** Who is calling a candidate route, loaded fresh from the database by the guard. */
export interface CandidateContext {
    sessionId: number;
    scheduleId: number;
    status: TestStatus;
    level: TestLevel;
    durationMinutes: number;
    startsAt: Date;
    endsAt: Date;
    fullName: string;
    email: string;
}

export type CandidateRequest = Request & { candidate?: CandidateContext };

export type TestState = 'NOT_OPEN' | 'READY' | 'IN_PROGRESS' | 'SUBMITTED';

export interface CandidateTestView {
    state: TestState;
    candidate: { fullName: string };
    level: TestLevel;
    durationMinutes: number;
    startsAt: Date;
    endsAt: Date;
    latestStartAt: Date;
    serverTime: Date;
    /** What the candidate is about to take. Null if no test is published for their level. */
    test: { questionCount: number; sections: { topic: string; questions: number }[]; instructionsMd: string | null } | null;
}

export interface AttemptOption {
    id: number;
    textMd: string;
}

/** A question as the candidate sees it. There is deliberately no field here that says which option is right. */
export interface AttemptQuestion {
    questionVersionId: number;
    title: string;
    statementMd: string;
    codeStubs: unknown;
    options: AttemptOption[];
    selectedOptionId: number | null;
}

export interface AttemptSectionView {
    topic: string;
    questions: AttemptQuestion[];
}

export interface AttemptView {
    status: 'IN_PROGRESS' | 'SUBMITTED';
    startedAt: Date;
    deadlineAt: Date;
    submittedAt: Date | null;
    serverTime: Date;
    /** Empty once submitted. */
    sections: AttemptSectionView[];
}
