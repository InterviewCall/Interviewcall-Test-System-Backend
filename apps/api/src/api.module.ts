import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ModelModule } from '@app/model';
import { AuthGuard } from './auth/auth.guard.js';
import { AuthModule } from './auth/auth.module.js';
import { RolesGuard } from './auth/roles.guard.js';
import { AppConfigModule } from './config/app.config.js';
import { HealthModule } from './health/health.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
    imports: [
        AppConfigModule,
        ModelModule,
        // Per client IP. In memory, which is right for one API process; move the
        // storage to Redis or the database if the API is ever scaled out.
        ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }] }),
        AuthModule,
        UsersModule,
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
