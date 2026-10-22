import type { z } from 'zod';
import type { listSchedulesQuerySchema, rescheduleTestSchema, scheduleTestSchema } from '../test-schedules.schemas.js';

export type ScheduleTestInput = z.output<typeof scheduleTestSchema>;
export type ListSchedulesQuery = z.output<typeof listSchedulesQuerySchema>;
export type RescheduleTestInput = z.output<typeof rescheduleTestSchema>;
