import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationsService } from '@app/notifications';
import type { StaffAccountReason } from '@app/notifications';
import { UserStatus } from '@app/prisma';
import { EmailAlreadyExistsError, UserRepository } from './user.repository.js';
import { PasswordService } from '../auth/password.service.js';
import { SessionService } from '../auth/session.service.js';
import type { AuthUser } from '../common/types/authenticated-request.types.js';
import type { Page } from '../common/types/pagination.types.js';
import type { UserWithTemporaryPassword } from './types/user.types.js';
import type { CreateUserInput, ListUsersQuery, UpdateUserInput } from './types/user-input.types.js';

@Injectable()
export class UsersService {
    private readonly logger = new Logger(UsersService.name);

    constructor(
        private readonly users: UserRepository,
        private readonly passwords: PasswordService,
        private readonly sessions: SessionService,
        private readonly notifications: NotificationsService,
    ) {}

    async create(dto: CreateUserInput, actor: AuthUser): Promise<UserWithTemporaryPassword> {
        const temporaryPassword = this.passwords.generateTemporaryPassword();
        const passwordHash = await this.passwords.hash(temporaryPassword);

        try {
            const user = await this.users.create({
                fullName: dto.fullName,
                email: dto.email,
                phone: dto.phone,
                role: dto.role,
                passwordHash,
                status: UserStatus.UNACTIVATED,
            });
            this.logger.log(`User ${user.id} (${user.role}) created by user ${actor.id}`);
            const emailQueued = await this.emailSignInDetails(user, temporaryPassword, 'created');
            return { user, temporaryPassword, emailQueued };
        } catch (error) {
            if (error instanceof EmailAlreadyExistsError) {
                throw new ConflictException('A user with this email already exists');
            }
            throw error;
        }
    }

    async list(query: ListUsersQuery): Promise<Page<AuthUser>> {
        const { items, total } = await this.users.findPage(
            { role: query.role, status: query.status, q: query.q },
            { skip: (query.page - 1) * query.pageSize, take: query.pageSize },
        );
        return { items, total, page: query.page, pageSize: query.pageSize };
    }

    async get(id: number): Promise<AuthUser> {
        const user = await this.users.findById(id);
        if (!user) throw new NotFoundException('User not found');
        return user;
    }

    /** The devices a staff member is signed in on. `current` is true only for the caller's own session. */
    async listSessions(id: number, currentSessionId: number) {
        await this.get(id);
        const rows = await this.sessions.listActive(id);
        return rows.map((row) => ({ ...row, current: row.id === currentSessionId }));
    }

    async update(id: number, dto: UpdateUserInput, actor: AuthUser): Promise<AuthUser> {
        if (id === actor.id && dto.role !== undefined && dto.role !== actor.role) {
            // Otherwise the last admin could lock everyone out of user management.
            throw new BadRequestException('You cannot change your own role');
        }
        await this.get(id);

        const user = await this.users.update(id, {
            fullName: dto.fullName,
            phone: dto.phone,
            role: dto.role,
        });
        this.logger.log(`User ${id} updated by user ${actor.id}`);
        return user;
    }

    async deactivate(id: number, actor: AuthUser): Promise<AuthUser> {
        if (id === actor.id) throw new BadRequestException('You cannot deactivate yourself');
        await this.get(id);

        const user = await this.users.update(id, { status: UserStatus.INACTIVE });
        await this.sessions.revokeAllForUser(id);
        this.logger.log(`User ${id} deactivated by user ${actor.id}`);
        return user;
    }

    /** Brings an inactive account back. It returns as UNACTIVATED with a fresh temporary password. */
    async reactivate(id: number, actor: AuthUser): Promise<UserWithTemporaryPassword> {
        const existing = await this.get(id);
        if (existing.status !== UserStatus.INACTIVE) {
            throw new BadRequestException('User is not deactivated');
        }
        return this.issueTemporaryPassword(id, actor, 'reactivated');
    }

    async resetPassword(id: number, actor: AuthUser): Promise<UserWithTemporaryPassword> {
        if (id === actor.id) {
            throw new BadRequestException('Use change password for your own account');
        }
        const existing = await this.get(id);
        if (existing.status === UserStatus.INACTIVE) {
            throw new BadRequestException('User is deactivated; reactivate the account instead');
        }
        return this.issueTemporaryPassword(id, actor, 'password reset');
    }

    private async issueTemporaryPassword(
        id: number,
        actor: AuthUser,
        reason: 'reactivated' | 'password reset',
    ): Promise<UserWithTemporaryPassword> {
        const temporaryPassword = this.passwords.generateTemporaryPassword();
        const passwordHash = await this.passwords.hash(temporaryPassword);

        const user = await this.users.update(id, { passwordHash, status: UserStatus.UNACTIVATED });
        await this.sessions.revokeAllForUser(id);
        this.logger.log(`User ${id} ${reason} by user ${actor.id}`);
        const emailQueued = await this.emailSignInDetails(
            user,
            temporaryPassword,
            reason === 'reactivated' ? 'reactivated' : 'reset',
        );
        return { user, temporaryPassword, emailQueued };
    }

    /**
     * The admin still gets the password on screen, so a failed email is reported, not raised:
     * `emailQueued: false` tells them to pass it on themselves.
     */
    private emailSignInDetails(
        user: AuthUser,
        temporaryPassword: string,
        reason: StaffAccountReason,
    ): Promise<boolean> {
        return this.notifications.sendStaffAccountReady({
            fullName: user.fullName,
            email: user.email,
            role: user.role,
            temporaryPassword,
            reason,
        });
    }
}
