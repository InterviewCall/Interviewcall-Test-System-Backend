import { Module } from '@nestjs/common';
import { UserRepository } from './user.repository.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

// PasswordService and SessionService come from the global AuthModule.
@Module({
    controllers: [UsersController],
    providers: [UserRepository, UsersService],
    exports: [UserRepository],
})
export class UsersModule {}
