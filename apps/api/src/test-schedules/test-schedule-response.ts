import { latestStartAt } from './test-levels.js';
import type { ScheduleRecord, ScheduleResponse } from './types/test-schedule.types.js';

export function toScheduleResponse(schedule: ScheduleRecord): ScheduleResponse {
    const { invitationMailStatus, invitationMailDetail, invitationMailUpdatedAt, ...rest } = schedule;
    return {
        ...rest,
        latestStartAt: latestStartAt(schedule.endsAt, schedule.durationMinutes),
        invitationMail: invitationMailStatus
            ? { status: invitationMailStatus, detail: invitationMailDetail, updatedAt: invitationMailUpdatedAt ?? schedule.createdAt }
            : null,
    };
}
