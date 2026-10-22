import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { HealthRepository } from './health.repository.js';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
    constructor(private readonly health: HealthRepository) {}

    @Get()
    @ApiOperation({ summary: 'Liveness plus a database ping, for the load balancer' })
    async check(): Promise<{ status: 'ok' }> {
        try {
            await this.health.ping();
        } catch {
            throw new ServiceUnavailableException('Database unreachable');
        }
        return { status: 'ok' };
    }
}
