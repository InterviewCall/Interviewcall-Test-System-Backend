import { BadRequestException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { UserStatus } from '@app/prisma';
import { UserRepository } from '../users/user.repository.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';
import type { SessionMeta } from './types/session.types.js';
import type { AuthResult } from './types/auth.types.js';

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);

    constructor(
        private readonly users: UserRepository,
        private readonly passwords: PasswordService,
        private readonly sessions: SessionService,
    ) {}

    async login(email: string, password: string, meta: SessionMeta): Promise<AuthResult> {
        const found = await this.users.findByEmailWithPasswordHash(email);

        const passwordOk = found
            ? await this.passwords.verify(found.passwordHash, password)
            : await this.passwords.verifyDummy(password);

        // One message for every failure, so the response never says which emails exist
        // or which accounts are switched off.
        if (!found || !passwordOk || found.status === UserStatus.INACTIVE) {
            this.logger.warn(`Failed login for ${email} from ${meta.ip ?? 'unknown ip'}`);
            throw new UnauthorizedException('Invalid email or password');
        }

        const { passwordHash: _omit, ...user } = found;
        const now = new Date();
        await this.users.update(user.id, { lastLoginAt: now });
        const session = await this.sessions.create(user.id, meta, now);

        return { user: { ...user, lastLoginAt: now }, session };
    }

    async logout(token: string | undefined): Promise<void> {
        if (token) await this.sessions.revokeByToken(token);
    }

    /**
     * Sets a new password, activates the account, and replaces every session with a
     * fresh one for the caller (so a stolen old cookie dies and nothing is fixated).
     */
    async changePassword(
        userId: number,
        currentPassword: string,
        newPassword: string,
        meta: SessionMeta,
    ): Promise<AuthResult> {
        const record = await this.users.findByIdWithPasswordHash(userId);
        if (!record) throw new NotFoundException('User not found');

        if (!(await this.passwords.verify(record.passwordHash, currentPassword))) {
            throw new BadRequestException({
                statusCode: 400,
                code: 'CURRENT_PASSWORD_INCORRECT',
                message: 'Current password is incorrect',
            });
        }
        if (currentPassword === newPassword) {
            throw new BadRequestException('New password must be different from the current one');
        }
        const emailName = record.email.split('@')[0].toLowerCase();
        if (emailName.length >= 4 && newPassword.toLowerCase().includes(emailName)) {
            throw new BadRequestException('New password must not contain your email name');
        }

        const passwordHash = await this.passwords.hash(newPassword);
        const updated = await this.users.update(userId, { passwordHash, status: UserStatus.ACTIVE });
        await this.sessions.revokeAllForUser(userId);
        const session = await this.sessions.create(userId, meta);

        this.logger.log(`Password changed for user ${userId}`);
        return { user: updated, session };
    }

    async listSessions(userId: number, currentSessionId: number) {
        const rows = await this.sessions.listActive(userId);
        return rows.map((row) => ({ ...row, current: row.id === currentSessionId }));
    }

    async revokeSession(userId: number, sessionId: number): Promise<void> {
        const revoked = await this.sessions.revokeOwn(userId, sessionId);
        if (!revoked) throw new NotFoundException('Session not found');
    }
}
