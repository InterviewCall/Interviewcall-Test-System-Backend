import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { TestStatus } from '@app/prisma';
import { clientIp, clientUserAgent } from '../common/http/authenticated-request.js';
import { portalIsOpen, sessionExpiry } from './candidate-window.js';
import { CandidateRepository } from './candidate.repository.js';
import type { ScheduleForSession } from './candidate.repository.js';
import { hashToken, newSecretToken } from './invite-token.js';
import type { CandidateContext } from './types/candidate.types.js';

const NOT_VALID = 'This link or email address is not valid';
const CLOSED = {
    statusCode: 403,
    code: 'TEST_CLOSED',
    message: 'This test is no longer open. Ask your advisor to reschedule it and you will get a new link.',
};

function toContext(sessionId: number, schedule: ScheduleForSession): CandidateContext {
    return {
        sessionId,
        scheduleId: schedule.id,
        status: schedule.status,
        level: schedule.level,
        durationMinutes: schedule.durationMinutes,
        startsAt: schedule.startsAt,
        endsAt: schedule.endsAt,
        fullName: schedule.candidate.fullName,
        email: schedule.candidate.email,
    };
}

@Injectable()
export class CandidateAccessService {
    constructor(private readonly repo: CandidateRepository) {}

    /**
     * Swaps the secret from the email link plus the candidate's email for a browser session.
     * A wrong link and a wrong email look the same, so nobody can use this to find out who is registered.
     */
    async createSession(token: string, email: string, req: Request): Promise<{ token: string; expiresAt: Date }> {
        const schedule = await this.repo.findScheduleByTokenHash(hashToken(token));
        if (!schedule || schedule.candidate.email.toLowerCase() !== email) throw new UnauthorizedException(NOT_VALID);
        if (schedule.status === TestStatus.EXPIRED || !portalIsOpen(schedule, new Date())) throw new ForbiddenException(CLOSED);

        const sessionToken = newSecretToken();
        const expiresAt = sessionExpiry(schedule.endsAt);
        await this.repo.createSession({
            testScheduleId: schedule.id,
            tokenHash: hashToken(sessionToken),
            ip: clientIp(req),
            userAgent: clientUserAgent(req),
            expiresAt,
        });
        return { token: sessionToken, expiresAt };
    }

    /** Used by the guard on every candidate request. */
    async validate(sessionToken: string): Promise<CandidateContext> {
        const session = await this.repo.findSession(hashToken(sessionToken));
        const now = new Date();
        const endedMessage = 'Your session has ended. Open your test link again.';
        if (!session || session.revokedAt) throw new UnauthorizedException(endedMessage);
        // A submitted test keeps its session a little past the window, for feedback.
        const submitted = session.testSchedule.status === TestStatus.SUBMITTED;
        if (session.expiresAt <= now && !submitted) throw new UnauthorizedException(endedMessage);
        if (!portalIsOpen(session.testSchedule, now)) throw new ForbiddenException(CLOSED);
        return toContext(session.id, session.testSchedule);
    }

    async end(sessionId: number): Promise<void> {
        await this.repo.revokeSession(sessionId);
    }
}
