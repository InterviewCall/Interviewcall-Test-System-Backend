import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@app/prisma';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import type { AuthUser } from '../common/types/authenticated-request.types.js';
import type { Page } from '../common/types/pagination.types.js';
import { ApiZodBody, ApiZodQuery, ApiZodResponse } from '../common/zod/zod-swagger.js';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe.js';
import { toScheduleResponse } from './test-schedule-response.js';
import {
    listSchedulesQuerySchema,
    rescheduleTestSchema,
    schedulePageResponseSchema,
    scheduleResponseSchema,
    scheduleTestSchema,
    scheduleWithEmailStatusResponseSchema,
} from './test-schedules.schemas.js';
import { TestSchedulesService } from './test-schedules.service.js';
import type { ScheduleResponse, ScheduleWithEmailStatusResponse } from './types/test-schedule.types.js';
import type { ListSchedulesQuery, RescheduleTestInput, ScheduleTestInput } from './types/test-schedule-input.types.js';

@ApiTags('test-schedules')
@ApiCookieAuth()
@Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.ADVISOR)
@Controller('test-schedules')
export class TestSchedulesController {
    constructor(private readonly schedules: TestSchedulesService) {}

    @Post()
    @ApiOperation({
        summary: 'Schedule a test for a candidate and email them the invitation',
        description:
            'Creates the candidate if the email is new. A candidate has one test. The duration comes from the level: Intermediate 22 minutes, Advanced 12.',
    })
    @ApiZodBody(scheduleTestSchema)
    @ApiZodResponse(201, scheduleWithEmailStatusResponseSchema)
    async schedule(
        @Body(new ZodValidationPipe(scheduleTestSchema)) dto: ScheduleTestInput,
        @CurrentUser() actor: AuthUser,
    ): Promise<ScheduleWithEmailStatusResponse> {
        const { schedule, emailQueued } = await this.schedules.schedule(dto, actor);
        return { schedule: toScheduleResponse(schedule), emailQueued };
    }

    @Get()
    @ApiOperation({ summary: 'List scheduled tests. Advisors see their own; admins see everyone’s.' })
    @ApiZodQuery(listSchedulesQuerySchema)
    @ApiZodResponse(200, schedulePageResponseSchema)
    async list(
        @Query(new ZodValidationPipe(listSchedulesQuerySchema)) query: ListSchedulesQuery,
        @CurrentUser() actor: AuthUser,
    ): Promise<Page<ScheduleResponse>> {
        const page = await this.schedules.list(query, actor);
        return { ...page, items: page.items.map(toScheduleResponse) };
    }

    @Get(':id')
    @ApiZodResponse(200, scheduleResponseSchema)
    async get(@Param('id', ParseIntPipe) id: number, @CurrentUser() actor: AuthUser): Promise<ScheduleResponse> {
        return toScheduleResponse(await this.schedules.get(id, actor));
    }

    @Post(':id/reschedule')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Move a test to a new start window and email the candidate the new time',
        description:
            'Only the window changes; the level and duration stay. Allowed while the candidate has not started (invited, including a missed slot, or expired); a test in progress or submitted returns 409.',
    })
    @ApiZodBody(rescheduleTestSchema)
    @ApiZodResponse(200, scheduleWithEmailStatusResponseSchema)
    async reschedule(
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(rescheduleTestSchema)) dto: RescheduleTestInput,
        @CurrentUser() actor: AuthUser,
    ): Promise<ScheduleWithEmailStatusResponse> {
        const { schedule, emailQueued } = await this.schedules.reschedule(id, dto, actor);
        return { schedule: toScheduleResponse(schedule), emailQueued };
    }

    @Post(':id/resend-email')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Queue the invitation email again' })
    @ApiZodResponse(200, scheduleWithEmailStatusResponseSchema)
    async resendEmail(
        @Param('id', ParseIntPipe) id: number,
        @CurrentUser() actor: AuthUser,
    ): Promise<ScheduleWithEmailStatusResponse> {
        const { schedule, emailQueued } = await this.schedules.resendInvitation(id, actor);
        return { schedule: toScheduleResponse(schedule), emailQueued };
    }
}
