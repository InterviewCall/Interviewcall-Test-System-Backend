import {
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    ParseIntPipe,
    Patch,
    Post,
    Query,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@app/prisma';
import { z } from 'zod';
import { sessionResponseSchema } from '../auth/auth.schemas.js';
import { CurrentSessionId, CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import type { AuthUser } from '../common/types/authenticated-request.types.js';
import type { Page } from '../common/types/pagination.types.js';
import { ApiZodBody, ApiZodQuery, ApiZodResponse } from '../common/zod/zod-swagger.js';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe.js';
import { toUserResponse } from './user-response.js';
import {
    createUserSchema,
    listUsersQuerySchema,
    updateUserSchema,
    userPageResponseSchema,
    userResponseSchema,
    userWithTemporaryPasswordResponseSchema,
} from './users.schemas.js';
import type { UserResponse, UserWithTemporaryPasswordResponse } from './types/user.types.js';
import type { CreateUserInput, ListUsersQuery, UpdateUserInput } from './types/user-input.types.js';
import { UsersService } from './users.service.js';

@ApiTags('users')
@ApiCookieAuth()
@Roles(UserRole.ADMIN)
@Controller('users')
export class UsersController {
    constructor(private readonly users: UsersService) {}

    @Post()
    @ApiOperation({ summary: 'Create a staff account with a one-time temporary password' })
    @ApiZodBody(createUserSchema)
    @ApiZodResponse(201, userWithTemporaryPasswordResponseSchema)
    async create(
        @Body(new ZodValidationPipe(createUserSchema)) dto: CreateUserInput,
        @CurrentUser() actor: AuthUser,
    ): Promise<UserWithTemporaryPasswordResponse> {
        const { user, temporaryPassword, emailQueued } = await this.users.create(dto, actor);
        return { user: toUserResponse(user), temporaryPassword, emailQueued };
    }

    // The one thing a manager can do here: look. Everything else on this controller stays admin-only.
    @Get()
    @Roles(UserRole.ADMIN, UserRole.MANAGER)
    @ApiOperation({ summary: 'List staff accounts' })
    @ApiZodQuery(listUsersQuerySchema)
    @ApiZodResponse(200, userPageResponseSchema)
    async list(
        @Query(new ZodValidationPipe(listUsersQuerySchema)) query: ListUsersQuery,
    ): Promise<Page<UserResponse>> {
        const page = await this.users.list(query);
        return { ...page, items: page.items.map(toUserResponse) };
    }

    @Get(':id')
    @ApiZodResponse(200, userResponseSchema)
    async get(@Param('id', ParseIntPipe) id: number): Promise<UserResponse> {
        return toUserResponse(await this.users.get(id));
    }

    @Get(':id/sessions')
    @ApiOperation({ summary: "Where a staff member is signed in right now. Admins only; it can't sign anyone out." })
    @ApiZodResponse(200, z.array(sessionResponseSchema))
    sessions(@Param('id', ParseIntPipe) id: number, @CurrentSessionId() sessionId: number) {
        return this.users.listSessions(id, sessionId);
    }

    @Patch(':id')
    @ApiOperation({ summary: 'Edit name, phone or role' })
    @ApiZodBody(updateUserSchema)
    @ApiZodResponse(200, userResponseSchema)
    async update(
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(updateUserSchema)) dto: UpdateUserInput,
        @CurrentUser() actor: AuthUser,
    ): Promise<UserResponse> {
        return toUserResponse(await this.users.update(id, dto, actor));
    }

    @Post(':id/deactivate')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Switch an account off and sign it out everywhere' })
    @ApiZodResponse(200, userResponseSchema)
    async deactivate(
        @Param('id', ParseIntPipe) id: number,
        @CurrentUser() actor: AuthUser,
    ): Promise<UserResponse> {
        return toUserResponse(await this.users.deactivate(id, actor));
    }

    @Post(':id/reactivate')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Bring a deactivated account back with a new temporary password' })
    @ApiZodResponse(200, userWithTemporaryPasswordResponseSchema)
    async reactivate(
        @Param('id', ParseIntPipe) id: number,
        @CurrentUser() actor: AuthUser,
    ): Promise<UserWithTemporaryPasswordResponse> {
        const { user, temporaryPassword, emailQueued } = await this.users.reactivate(id, actor);
        return { user: toUserResponse(user), temporaryPassword, emailQueued };
    }

    @Post(':id/reset-password')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Issue a new temporary password and sign the user out everywhere' })
    @ApiZodResponse(200, userWithTemporaryPasswordResponseSchema)
    async resetPassword(
        @Param('id', ParseIntPipe) id: number,
        @CurrentUser() actor: AuthUser,
    ): Promise<UserWithTemporaryPasswordResponse> {
        const { user, temporaryPassword, emailQueued } = await this.users.resetPassword(id, actor);
        return { user: toUserResponse(user), temporaryPassword, emailQueued };
    }
}
