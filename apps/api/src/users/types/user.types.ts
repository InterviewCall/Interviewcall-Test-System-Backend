import type { UserRole, UserStatus } from '@app/prisma';

/** A user as the API handles them: every column except the password hash. */
export interface UserRecord {
    id: number;
    fullName: string;
    email: string;
    phone: string;
    role: UserRole;
    status: UserStatus;
    lastLoginAt: Date | null;
    createdAt: Date;
}

export interface UserWithPasswordHash extends UserRecord {
    passwordHash: string;
}

export interface NewUser {
    fullName: string;
    email: string;
    phone: string;
    role: UserRole;
    passwordHash: string;
    status: UserStatus;
}

export interface UserChanges {
    fullName?: string;
    phone?: string;
    role?: UserRole;
    status?: UserStatus;
    passwordHash?: string;
    lastLoginAt?: Date;
}

export interface UserFilter {
    role?: UserRole;
    status?: UserStatus;
    /** Matches full name or email. */
    q?: string;
}

export interface UserWithTemporaryPassword {
    user: UserRecord;
    temporaryPassword: string;
    /** Whether the sign-in email was queued. False means the admin must pass the password on. */
    emailQueued: boolean;
}

/** The public shape of a user in API responses. */
export type UserResponse = UserRecord;

export interface UserWithTemporaryPasswordResponse {
    user: UserResponse;
    temporaryPassword: string;
    emailQueued: boolean;
}
