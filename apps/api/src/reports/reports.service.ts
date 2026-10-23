import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { seesAllTests } from '../common/roles.js';
import type { AuthUser } from '../common/types/authenticated-request.types.js';
import { buildReport } from './build-report.js';
import { ReportsRepository } from './reports.repository.js';
import type { TestReport } from './types/report.types.js';

@Injectable()
export class ReportsService {
    constructor(private readonly reports: ReportsRepository) {}

    async get(scheduleId: number, actor: AuthUser): Promise<TestReport> {
        const owner = await this.reports.findOwner(scheduleId);
        // An advisor asking for someone else's test gets the same answer as for a test that doesn't exist.
        if (!owner || (!seesAllTests(actor.role) && owner.invitedById !== actor.id)) {
            throw new NotFoundException('Test not found');
        }

        const source = await this.reports.load(scheduleId);
        if (!source) {
            throw new ConflictException({
                statusCode: 409,
                code: 'REPORT_NOT_READY',
                message: 'There is no report yet: the candidate has not submitted this test',
            });
        }
        return buildReport(source);
    }
}
