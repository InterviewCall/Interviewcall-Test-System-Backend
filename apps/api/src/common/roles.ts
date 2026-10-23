import { UserRole } from '@app/prisma';

/**
 * Roles that work with every advisor's tests, not only their own. Admins manage the
 * console; managers oversee the advisors, so both see and act on all tests and reports.
 */
export function seesAllTests(role: UserRole): boolean {
    return role === UserRole.ADMIN || role === UserRole.MANAGER;
}
