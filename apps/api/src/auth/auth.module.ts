import { Global, Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { SessionRepository } from './session.repository.js';
import { SessionService } from './session.service.js';

// Global so UsersModule can use PasswordService and SessionService without importing
// AuthModule back (AuthModule already imports UsersModule for UserRepository).
@Global()
@Module({
    imports: [UsersModule],
    controllers: [AuthController],
    providers: [AuthService, PasswordService, SessionRepository, SessionService],
    exports: [PasswordService, SessionService],
})
export class AuthModule {}
