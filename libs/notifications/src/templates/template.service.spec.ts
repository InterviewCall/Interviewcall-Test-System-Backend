import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TemplateService, findTemplateRoot } from './template.service.js';
import { MAIL_TEMPLATES } from './mail-templates.js';
import type { MailGlobals, StaffAccountReason } from '../types/mail.types.js';

const globals: MailGlobals = { appName: 'InterviewCall', staffConsoleUrl: 'https://console.example.com',
    testPortalUrl: 'https://test.example.com',
    year: 2026,
};
const input = {
    fullName: 'Priya Nair',
    email: 'priya@example.com',
    roleLabel: 'Advisor',
    reason: 'created' as StaffAccountReason,
    temporaryPassword: 'Xk7mPq2RtV9wHn4Z',
};

function render(overrides: Partial<typeof input> = {}) {
    const service = new TemplateService();
    service.onModuleInit();
    const data = { ...input, ...overrides };
    const template = MAIL_TEMPLATES['staff-account-ready'];
    return {
        ...service.renderMail('staff-account-ready', template.view(data, globals)),
        subject: template.subject(data, globals),
    };
}

describe('staff-account-ready email', () => {
    it('shows the sign-in details in both the HTML and the plain text', () => {
        const { html, text, subject } = render();
        expect(subject).toBe('Your InterviewCall console account is ready');
        for (const body of [html, text]) {
            expect(body).toContain('Hi Priya,');
            expect(body).toContain('priya@example.com');
            expect(body).toContain('Advisor');
            expect(body).toContain('Xk7mPq2RtV9wHn4Z');
            expect(body).toContain('https://console.example.com/login');
        }
        expect(html).toContain('<a href="https://console.example.com/login"');
        expect(html).toContain('<html');
    });

    it('has no unfilled or leaked template syntax', () => {
        const { html, text } = render();
        expect(html).not.toMatch(/\{\{|\}\}/);
        expect(text).not.toMatch(/\{\{|\}\}/);
        expect(html).not.toContain('undefined');
    });

    it('words each reason differently', () => {
        expect(render({ reason: 'reset' })).toMatchObject({ subject: 'Your InterviewCall console password was reset' });
        expect(render({ reason: 'reset' }).text).toContain('Your password was reset');
        expect(render({ reason: 'reactivated' }).subject).toBe('Your InterviewCall console account is active again');
        expect(render({ reason: 'reactivated' }).text).toContain('turned your account back on');
    });

    it('escapes HTML in names, but never mangles the plain-text password', () => {
        const nasty = { fullName: '<script>alert(1)</script> Eve', temporaryPassword: 'a&b<c>"d\'=' };
        const { html, text } = render(nasty);
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
        expect(html).toContain('a&amp;b&lt;c&gt;');
        expect(text).toContain('Temporary password: a&b<c>"d\'=');
    });

    it('finds the templates folder, or says nothing was found', () => {
        const here = dirname(fileURLToPath(import.meta.url));
        expect(findTemplateRoot(['/nonexistent', here])).toBe(here);
        expect(findTemplateRoot(['/nonexistent', '/also/missing'])).toBeUndefined();
    });

    it('rejects an unknown template id', () => {
        const service = new TemplateService();
        service.onModuleInit();
        expect(() => service.renderMail('nope' as never, {})).toThrow('Unknown email template: nope');
    });
});

describe('candidate-test-scheduled email', () => {
    const data = {
        fullName: 'Rohan Das Gupta',
        startsAt: '2026-10-24T05:30:00.000Z',
        endsAt: '2026-10-24T06:30:00.000Z',
        durationMinutes: 22,
        inviteToken: 'Xq3v9Lm2Zr7Tp5Wc8Nb4Hd6Ja1Ks0Ye3Uf2Gi9Ro',
    };

    function renderCandidate(overrides: Partial<typeof data> = {}) {
        const service = new TemplateService();
        service.onModuleInit();
        const template = MAIL_TEMPLATES['candidate-test-scheduled'];
        const parsed = template.schema.parse({ ...data, ...overrides });
        return {
            ...service.renderMail('candidate-test-scheduled', template.view(parsed, globals)),
            subject: template.subject(parsed, globals),
            sender: template.sender,
        };
    }

    it('goes out from the candidates address', () => {
        expect(renderCandidate().sender).toBe('candidates');
        expect(MAIL_TEMPLATES['staff-account-ready'].sender).toBe('accounts');
    });

    it('puts the test length in the subject, so a 12-minute test says 12', () => {
        expect(renderCandidate({ durationMinutes: 12 }).subject).toBe('Your next InterviewCall step: 12-minute readiness assessment');
    });

    it('fills in the name, duration, slot and portal link in both versions', () => {
        const { html, text, subject } = renderCandidate();
        expect(subject).toBe('Your next InterviewCall step: 22-minute readiness assessment');
        for (const body of [html, text]) {
            expect(body).toContain('Hi Rohan,');
            expect(body).toContain('It takes approximately 22 minutes.');
            expect(body).toContain('Scheduled: 24 October 2026, 11:00 AM – 12:00 PM IST');
            expect(body).toContain('https://test.example.com/t/Xq3v9Lm2Zr7Tp5Wc8Nb4Hd6Ja1Ks0Ye3Uf2Gi9Ro');
            expect(body).toContain('Don\'t worry about trying to manufacture a perfect score');
        }
        expect(html).toContain('<a href="https://test.example.com/t/Xq3v9Lm2Zr7Tp5Wc8Nb4Hd6Ja1Ks0Ye3Uf2Gi9Ro"');
        expect(html).toContain('"good" or "bad."');
    });

    it.each([
        [22, 'INTERMEDIATE'],
        [12, 'ADVANCED'],
    ])('says %i minutes when the test is %i minutes long', (minutes) => {
        const { html, text } = renderCandidate({ durationMinutes: minutes });
        for (const body of [html, text]) expect(body).toContain(`approximately ${minutes} minutes`);
    });

    it('has no leftover template syntax, and its footer does not claim replies are ignored', () => {
        const { html, text } = renderCandidate();
        expect(html).not.toMatch(/\{\{|\}\}|undefined/);
        expect(text).not.toMatch(/\{\{|\}\}|undefined/);
        expect(html).toContain('our team scheduled an assessment for this email address');
        expect(html).not.toContain('not monitored');
    });

    it('escapes the candidate name in HTML', () => {
        const { html } = renderCandidate({ fullName: '<b>Eve</b> X' });
        expect(html).not.toContain('<b>Eve');
    });

    it('rejects data that would print nonsense', () => {
        const schema = MAIL_TEMPLATES['candidate-test-scheduled'].schema;
        expect(() => schema.parse({ ...data, startsAt: 'tomorrow' })).toThrow();
        expect(() => schema.parse({ ...data, durationMinutes: '0' })).toThrow();
        expect(() => schema.parse({ ...data, durationMinutes: 'abc' })).toThrow();
    });
});

describe('candidate-test-rescheduled email', () => {
    const data = {
        fullName: 'Rohan Das Gupta',
        startsAt: '2026-10-26T04:30:00.000Z',
        endsAt: '2026-10-26T05:30:00.000Z',
        durationMinutes: 12,
        inviteToken: 'Xq3v9Lm2Zr7Tp5Wc8Nb4Hd6Ja1Ks0Ye3Uf2Gi9Ro',
    };

    function render() {
        const service = new TemplateService();
        service.onModuleInit();
        const template = MAIL_TEMPLATES['candidate-test-rescheduled'];
        const parsed = template.schema.parse(data);
        return {
            ...service.renderMail('candidate-test-rescheduled', template.view(parsed, globals)),
            subject: template.subject(parsed, globals),
            sender: template.sender,
        };
    }

    it('goes out from the candidates address and says the time changed', () => {
        const { subject, sender } = render();
        expect(sender).toBe('candidates');
        expect(subject).toBe('Your InterviewCall readiness assessment has a new time');
    });

    it('shows the new window, the duration and the portal link in both versions', () => {
        const { html, text } = render();
        for (const body of [html, text]) {
            expect(body).toContain('Hi Rohan,');
            expect(body).toContain('has been moved to a new time');
            expect(body).toContain('Scheduled: 26 October 2026, 10:00 AM – 11:00 AM IST');
            expect(body).toContain('approximately 12 minutes');
            expect(body).toContain('https://test.example.com/t/Xq3v9Lm2Zr7Tp5Wc8Nb4Hd6Ja1Ks0Ye3Uf2Gi9Ro');
            expect(body).not.toMatch(/\{\{|\}\}|undefined/);
        }
        expect(html).toContain('our team rescheduled an assessment for this email address');
    });
});
