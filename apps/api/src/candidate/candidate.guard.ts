import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { APP_CONFIG } from '../config/app.config.js';
import type { AppConfig } from '../config/types/app-config.types.js';
import { CandidateAccessService } from './candidate-access.service.js';
import type { CandidateRequest } from './types/candidate.types.js';

/** Candidate routes are @Public() for the staff guard and use this one instead. */
@Injectable()
export class CandidateGuard implements CanActivate {
    constructor(
        private readonly access: CandidateAccessService,
        @Inject(APP_CONFIG) private readonly config: AppConfig,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const req = context.switchToHttp().getRequest<CandidateRequest>();
        const token: unknown = req.cookies?.[this.config.cookie.candidateName];
        if (typeof token !== 'string' || token === '') throw new UnauthorizedException('Open your test link to begin');
        req.candidate = await this.access.validate(token);
        return true;
    }
}
