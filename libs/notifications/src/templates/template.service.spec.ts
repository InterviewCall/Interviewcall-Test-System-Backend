import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TemplateService, findTemplateRoot } from './template.service.js';
import { MAIL_TEMPLATES } from './mail-templates.js';
import type { MailGlobals, StaffAccountReason } from '../types/mail.types.js';

const globals: MailGlobals = { appName: 'InterviewCall', staffConsoleUrl: 'https://console.example.com', year: 2026 };
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
