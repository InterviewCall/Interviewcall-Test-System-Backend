import { z } from 'zod';
import type { MailGlobals, MailSender, MailTemplateId } from '../types/mail.types.js';

interface MailTemplate<S extends z.ZodType> {
    /** Which configured from-address this email goes out from. */
    sender: MailSender;
    /**
     * Everything the template needs: the plain params plus the secrets, checked before rendering.
     * The producer decides which of these travel sealed (see NotificationsService).
     */
    schema: S;
    subject: (data: z.infer<S>, globals: MailGlobals) => string;
    /** Turns the data into exactly what the .hbs files print, so the templates stay free of logic. */
    view: (data: z.infer<S>, globals: MailGlobals) => Record<string, unknown>;
}

function defineMailTemplate<S extends z.ZodType>(template: MailTemplate<S>): MailTemplate<S> {
    return template;
}

const staffAccountReady = defineMailTemplate({
    sender: 'accounts',
    schema: z.object({
        fullName: z.string().min(1),
        email: z.string().min(3),
        roleLabel: z.string().min(1),
        reason: z.enum(['created', 'reset', 'reactivated']),
        temporaryPassword: z.string().min(1),
    }),
    subject: (data, { appName }) =>
        ({
            created: `Your ${appName} console account is ready`,
            reset: `Your ${appName} console password was reset`,
            reactivated: `Your ${appName} console account is active again`,
        })[data.reason],
    view: (data, globals) => {
        const copy = {
            created: {
                headline: 'Your account is ready',
                intro: `An admin set up your ${globals.appName} console account. Sign in with the temporary password below, then choose a password of your own.`,
            },
            reset: {
                headline: 'Your password was reset',
                intro: 'An admin reset your password. Your old password and any signed-in devices no longer work. Sign in with the temporary password below, then choose a new one.',
            },
            reactivated: {
                headline: 'Your account is active again',
                intro: 'An admin turned your account back on. Sign in with the temporary password below, then choose a password of your own.',
            },
        }[data.reason];

        return {
            ...globals,
            ...data,
            ...copy,
            firstName: data.fullName.trim().split(/\s+/)[0],
            signInUrl: `${globals.staffConsoleUrl}/login`,
            preheader: `${copy.headline}. Your temporary password is inside.`,
        };
    },
});

/** One entry per id in MAIL_TEMPLATE_IDS. The compiler enforces it. */
export const MAIL_TEMPLATES = {
    'staff-account-ready': staffAccountReady,
} satisfies Record<MailTemplateId, MailTemplate<z.ZodType>>;

export type StaffAccountReadyData = z.infer<typeof staffAccountReady.schema>;
