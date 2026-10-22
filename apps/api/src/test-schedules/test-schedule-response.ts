import { latestStartAt } from './test-levels.js';
import type { ScheduleRecord, ScheduleResponse } from './types/test-schedule.types.js';

export function toScheduleResponse(schedule: ScheduleRecord): ScheduleResponse {
    return { ...schedule, latestStartAt: latestStartAt(schedule.endsAt, schedule.durationMinutes) };
}
