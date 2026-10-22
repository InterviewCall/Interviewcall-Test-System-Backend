import { Injectable } from '@nestjs/common';
import { ModelService } from '@app/model';

@Injectable()
export class HealthRepository {
    constructor(private readonly db: ModelService) {}

    /** Throws if the database cannot answer. */
    async ping(): Promise<void> {
        await this.db.$queryRaw`SELECT 1`;
    }
}
