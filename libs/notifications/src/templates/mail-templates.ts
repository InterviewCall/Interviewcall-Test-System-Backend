import { z } from 'zod';
import { formatWindow } from '../utils/datetime.js';
import { testStartUrl } from '../utils/start-url.js';
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

/** A template with its types erased, which is what the processor needs: it only ever has raw job data. */
export interface PreparedMail {
    sender: MailSender;
    subject: string;
    view: Record<string, unknown>;
}

type DefinedMailTemplate<S extends z.ZodType> = MailTemplate<S> & {
    /** Checks the raw data against the schema, then builds the subject and the values the .hbs files print. Throws if it doesn't fit. */
    prepare: (raw: unknown, globals: MailGlobals) => PreparedMail;
};

function defineMailTemplate<S extends z.ZodType>(template: MailTemplate<S>): DefinedMailTemplate<S> {
    return {
        ...template,
        prepare: (raw, globals) => {
            const data = template.schema.parse(raw);
            return { sender: template.sender, subject: template.subject(data, globals), view: template.view(data, globals) };
        },
    };
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
            footerNote: `Sent by ${globals.appName} because an admin set up an account for this email address. Replies to this message are not monitored.`,
        };
    },
});

/** The data both candidate emails carry: who, and the slot. Params travel through Redis as strings. */
const candidateSlotSchema = z.object({
    fullName: z.string().min(1),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    durationMinutes: z.coerce.number().int().min(1).max(600),
    /** Arrives from the sealed part of the job. */
    inviteToken: z.string().min(16),
});

const candidateTestScheduled = defineMailTemplate({
    sender: 'candidates',
    schema: candidateSlotSchema,
    subject: (data, { appName }) => `Your next ${appName} step: ${data.durationMinutes}-minute readiness assessment`,
    view: (data, globals) => ({
        ...globals,
        firstName: data.fullName.trim().split(/\s+/)[0],
        durationMinutes: data.durationMinutes,
        scheduledAt: formatWindow(new Date(data.startsAt), new Date(data.endsAt)),
        startUrl: testStartUrl(globals.testPortalUrl, data.inviteToken),
        preheader: `Your assessment takes about ${data.durationMinutes} minutes.`,
        footerNote: `Sent by ${globals.appName} because our team scheduled an assessment for this email address.`,
    }),
});

const candidateTestRescheduled = defineMailTemplate({
    sender: 'candidates',
    schema: candidateSlotSchema,
    subject: (_data, { appName }) => `Your ${appName} readiness assessment has a new time`,
    view: (data, globals) => ({
        ...globals,
        firstName: data.fullName.trim().split(/\s+/)[0],
        durationMinutes: data.durationMinutes,
        scheduledAt: formatWindow(new Date(data.startsAt), new Date(data.endsAt)),
        startUrl: testStartUrl(globals.testPortalUrl, data.inviteToken),
        preheader: 'Your assessment has moved. Here is your new time.',
        footerNote: `Sent by ${globals.appName} because our team rescheduled an assessment for this email address.`,
    }),
});

/** One entry per id in MAIL_TEMPLATE_IDS. The compiler enforces it. */
export const MAIL_TEMPLATES = {
    'staff-account-ready': staffAccountReady,
    'candidate-test-scheduled': candidateTestScheduled,
    'candidate-test-rescheduled': candidateTestRescheduled,
} satisfies Record<MailTemplateId, { sender: MailSender; prepare: (raw: unknown, globals: MailGlobals) => PreparedMail }>;

export type StaffAccountReadyData = z.infer<typeof staffAccountReady.schema>;
