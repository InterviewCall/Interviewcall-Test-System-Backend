import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ModelModule } from '@app/model';
import { AuthGuard } from './auth/auth.guard.js';
import { AuthModule } from './auth/auth.module.js';
import { RolesGuard } from './auth/roles.guard.js';
import { AppConfigModule } from './config/app.config.js';
import { CandidateModule } from './candidate/candidate.module.js';
import { HealthModule } from './health/health.module.js';
import { MailEventsModule } from './mail-events/mail-events.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { TestSchedulesModule } from './test-schedules/test-schedules.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
    imports: [
        AppConfigModule,
        ModelModule,
        // Per client IP, so TRUST_PROXY_HOPS must match the proxies in front of the API. In memory, which is
        // right for one API process; move the storage to Redis if the API is ever scaled out. The ceiling is
        // generous on purpose: a whole class sitting a test behind one college router shares one IP, and each
        // answer they pick is a request. Login and the other sensitive routes set their own, much lower, limits.
        ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60_000, limit: 1200 }] }),
        AuthModule,
        UsersModule,
        TestSchedulesModule,
        ReportsModule,
        CandidateModule,
        MailEventsModule,
        HealthModule,
    ],
    providers: [
        // Order matters: throttle first, then require a session, then check the role.
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
    ],
})
export class ApiModule {}
