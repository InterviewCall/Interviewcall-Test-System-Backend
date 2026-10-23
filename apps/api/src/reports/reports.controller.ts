import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@app/prisma';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import type { AuthUser } from '../common/types/authenticated-request.types.js';
import { ApiZodResponse } from '../common/zod/zod-swagger.js';
import { testReportResponseSchema } from './reports.schemas.js';
import { ReportsService } from './reports.service.js';
import type { TestReport } from './types/report.types.js';

@ApiTags('reports')
@ApiCookieAuth()
@Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.ADVISOR)
@Controller('test-schedules/:id/report')
export class ReportsController {
    constructor(private readonly reports: ReportsService) {}

    @Get()
    @ApiOperation({
        summary: 'The report for a submitted test: score, topics and every answer next to the key',
        description:
            'Staff only. It contains the answer key, so it is never served to candidates. Advisors can open reports for their own candidates; admins for everyone. Returns 409 until the candidate has submitted.',
    })
    @ApiZodResponse(200, testReportResponseSchema)
    get(@Param('id', ParseIntPipe) id: number, @CurrentUser() actor: AuthUser): Promise<TestReport> {
        return this.reports.get(id, actor);
    }
}
