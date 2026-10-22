import { Injectable } from '@nestjs/common';
import { ModelService } from '@app/model';
import { Prisma } from '@app/prisma';
import type {
    NewUser,
    UserChanges,
    UserFilter,
    UserRecord,
    UserWithPasswordHash,
} from './types/user.types.js';

/** Every column except the password hash. Use this unless a caller must check a password. */
export const userSelect = {
    id: true,
    fullName: true,
    email: true,
    phone: true,
    role: true,
    status: true,
    lastLoginAt: true,
    createdAt: true,
} as const satisfies Prisma.UserSelect;

/** Thrown by create() when the email is taken, so callers never need Prisma error codes. */
export class EmailAlreadyExistsError extends Error {
    constructor(readonly email: string) {
        super(`A user with email ${email} already exists`);
        this.name = 'EmailAlreadyExistsError';
    }
}

@Injectable()
export class UserRepository {
    constructor(private readonly db: ModelService) {}

    findById(id: number): Promise<UserRecord | null> {
        return this.db.user.findUnique({ where: { id }, select: userSelect });
    }

    findByIdWithPasswordHash(id: number): Promise<UserWithPasswordHash | null> {
        return this.db.user.findUnique({
            where: { id },
            select: { ...userSelect, passwordHash: true },
        });
    }

    findByEmailWithPasswordHash(email: string): Promise<UserWithPasswordHash | null> {
        return this.db.user.findUnique({
            where: { email },
            select: { ...userSelect, passwordHash: true },
        });
    }

    async create(data: NewUser): Promise<UserRecord> {
        try {
            return await this.db.user.create({ data, select: userSelect });
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                throw new EmailAlreadyExistsError(data.email);
            }
            throw error;
        }
    }

    update(id: number, changes: UserChanges): Promise<UserRecord> {
        return this.db.user.update({ where: { id }, data: changes, select: userSelect });
    }

    async findPage(
        filter: UserFilter,
        paging: { skip: number; take: number },
    ): Promise<{ items: UserRecord[]; total: number }> {
        const where: Prisma.UserWhereInput = {
            ...(filter.role && { role: filter.role }),
            ...(filter.status && { status: filter.status }),
            ...(filter.q && {
                OR: [{ fullName: { contains: filter.q } }, { email: { contains: filter.q } }],
            }),
        };

        const [items, total] = await this.db.$transaction([
            this.db.user.findMany({
                where,
                select: userSelect,
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                skip: paging.skip,
                take: paging.take,
            }),
            this.db.user.count({ where }),
        ]);

        return { items, total };
    }
}
