import type { TestLevel, TestStatus } from '@app/prisma';

export interface ScheduleCandidate {
    id: number;
    fullName: string;
    email: string;
    phone: string | null;
}

/** A scheduled test with the candidate and the staff member who booked it. */
export interface ScheduleRecord {
    id: number;
    level: TestLevel;
    durationMinutes: number;
    startsAt: Date;
    endsAt: Date;
    status: TestStatus;
    invitationQueuedAt: Date | null;
    createdAt: Date;
    candidate: ScheduleCandidate;
    invitedBy: { id: number; fullName: string };
}

export interface NewSchedule {
    candidate: { fullName: string; email: string; phone?: string };
    invitedById: number;
    level: TestLevel;
    durationMinutes: number;
    startsAt: Date;
    endsAt: Date;
}

/** The new start window for a test that is being moved. */
export interface ScheduleWindow {
    startsAt: Date;
    endsAt: Date;
}

export interface ScheduleFilter {
    invitedById?: number;
    status?: TestStatus;
    level?: TestLevel;
    /** Matches the candidate's name or email. */
    q?: string;
    /** Only tests whose window opens at or after this. */
    startsFrom?: Date;
    /** Only tests whose window opens at or before this. */
    startsTo?: Date;
}

export interface ScheduledWithEmailStatus {
    schedule: ScheduleRecord;
    /** Whether the invitation email was queued. False means it still has to be sent (resend it). */
    emailQueued: boolean;
}

/** The public shape of a scheduled test in API responses. */
export interface ScheduleResponse extends ScheduleRecord {
    /** The last moment the candidate can start and still get the full duration. */
    latestStartAt: Date;
}

export interface ScheduleWithEmailStatusResponse {
    schedule: ScheduleResponse;
    emailQueued: boolean;
}
