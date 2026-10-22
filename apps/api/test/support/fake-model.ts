import { Prisma } from '@app/prisma';

type Row = Record<string, any>;

/** Applies a Prisma-style `select` (or leaves the row whole). */
function project(row: Row | null, select?: Record<string, any>): Row | null {
    if (!row) return null;
    if (!select) return { ...row };
    const out: Row = {};
    for (const [key, on] of Object.entries(select)) if (on) out[key] = row[key];
    return out;
}

function matches(row: Row, where: Row = {}): boolean {
    return Object.entries(where).every(([key, cond]) => {
        if (key === 'OR') return (cond as Row[]).some((sub) => matches(row, sub));
        if (cond === null) return row[key] === null;
        if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
            if ('gt' in cond) return row[key] > cond.gt;
            if ('contains' in cond) return String(row[key]).includes(cond.contains);
            return false;
        }
        return row[key] === cond;
    });
}

/**
 * A small in-memory stand-in for ModelService covering exactly the calls the auth and
 * users modules make. Lets the real guards, pipes and cookies run without MySQL.
 */
export function createFakeModel() {
    const users: Row[] = [];
    const sessions: Row[] = [];
    let userSeq = 0;
    let sessionSeq = 0;

    const user = {
        async findUnique({ where, select }: Row) {
            const row = users.find((u) => (where.id !== undefined ? u.id === where.id : u.email === where.email));
            return project(row ?? null, select);
        },
        async create({ data, select }: Row) {
            if (users.some((u) => u.email === data.email)) {
                throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
                    code: 'P2002',
                    clientVersion: 'test',
                });
            }
            const now = new Date();
            const row = { id: ++userSeq, lastLoginAt: null, createdAt: now, updatedAt: now, ...data };
            users.push(row);
            return project(row, select);
        },
        async update({ where, data, select }: Row) {
            const row = users.find((u) => u.id === where.id)!;
            Object.assign(row, data, { updatedAt: new Date() });
            return project(row, select);
        },
        async findMany({ where, select, skip = 0, take }: Row) {
            const rows = users.filter((u) => matches(u, where)).sort((a, b) => b.id - a.id);
            return rows.slice(skip, take === undefined ? undefined : skip + take).map((r) => project(r, select));
        },
        async count({ where }: Row) {
            return users.filter((u) => matches(u, where)).length;
        },
    };

    const session = {
        async create({ data }: Row) {
            const row = { id: ++sessionSeq, revokedAt: null, ...data };
            sessions.push(row);
            return { ...row };
        },
        async findUnique({ where, include, select }: Row) {
            const row = sessions.find((s) => s.tokenHash === where.tokenHash);
            if (!row) return null;
            const nestedUser = select?.user ?? include?.user;
            const { user: _skip, ...ownSelect } = select ?? {};
            const out: Row = select ? project(row, ownSelect)! : { ...row };
            if (nestedUser) {
                out.user = project(users.find((u) => u.id === row.userId)!, nestedUser === true ? undefined : nestedUser.select);
            }
            return out;
        },
        async update({ where, data }: Row) {
            const row = sessions.find((s) => s.id === where.id)!;
            Object.assign(row, data);
            return { ...row };
        },
        async updateMany({ where, data }: Row) {
            const rows = sessions.filter((s) => matches(s, where));
            rows.forEach((r) => Object.assign(r, data));
            return { count: rows.length };
        },
        async findMany({ where, select }: Row) {
            return sessions
                .filter((s) => matches(s, where))
                .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
                .map((r) => project(r, select));
        },
    };

    return {
        user,
        session,
        $queryRaw: async () => [{ 1: 1 }],
        $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
        // Test helpers
        _users: users,
        _sessions: sessions,
    };
}

export type FakeModel = ReturnType<typeof createFakeModel>;
