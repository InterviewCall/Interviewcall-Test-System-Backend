import { Module } from '@nestjs/common';
import { CandidateAccessService } from './candidate-access.service.js';
import { CandidateTestService } from './candidate-test.service.js';
import { CandidateController } from './candidate.controller.js';
import { CandidateGuard } from './candidate.guard.js';
import { CandidateRepository } from './candidate.repository.js';

@Module({
    controllers: [CandidateController],
    providers: [CandidateRepository, CandidateAccessService, CandidateTestService, CandidateGuard],
})
export class CandidateModule {}
