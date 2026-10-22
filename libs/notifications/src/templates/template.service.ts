import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import Handlebars from 'handlebars';
import { MAIL_TEMPLATE_IDS } from '../types/mail.types.js';
import type { MailTemplateId } from '../types/mail.types.js';

interface CompiledMail {
    html: HandlebarsTemplateDelegate;
    text: HandlebarsTemplateDelegate;
}

/** Looked up in this order. */
function candidateDirs(): string[] {
    const here = dirname(fileURLToPath(import.meta.url));
    return [
        process.env.NOTIFICATIONS_TEMPLATES_DIR,
        // A built worker: nest-cli copies the templates beside main.js, keeping their source path.
        join(here, 'libs/notifications/src/templates'),
        // Running from source (tests, tsx).
        here,
        join(process.cwd(), 'libs/notifications/src/templates'),
    ].filter((dir): dir is string => Boolean(dir));
}

/** The first folder that has a `mail/` directory, or undefined. */
export function findTemplateRoot(dirs: string[]): string | undefined {
    return dirs.find((dir) => existsSync(join(dir, 'mail')));
}

/**
 * Compiles the Handlebars files once at startup, so a missing or broken template stops the
 * worker from booting instead of failing the first real email.
 *
 * Each email is three files:
 *   mail/<id>.html.hbs   the HTML body, wrapped in the shared layout partial
 *   mail/<id>.text.hbs   the plain-text body (sent alongside the HTML; helps inbox placement)
 *   partials/layout.hbs  the branded frame
 */
@Injectable()
export class TemplateService implements OnModuleInit {
    private readonly logger = new Logger(TemplateService.name);
    private readonly mail = new Map<MailTemplateId, CompiledMail>();

    onModuleInit(): void {
        const dirs = candidateDirs();
        const root = findTemplateRoot(dirs);
        if (!root) throw new Error(`Email templates not found. Looked in: ${dirs.join(', ')}`);

        const html = Handlebars.create();
        const text = Handlebars.create();

        // HTML is escaped by default ({{value}}), so a name like "<script>" is inert.
        // Plain text must not be: "&" turning into "&amp;" would corrupt a password.
        const partials = join(root, 'partials');
        if (existsSync(partials)) {
            for (const file of readdirSync(partials).filter((name) => name.endsWith('.hbs'))) {
                html.registerPartial(file.replace(/\.hbs$/, ''), readFileSync(join(partials, file), 'utf8'));
            }
        }

        for (const id of MAIL_TEMPLATE_IDS) {
            const read = (kind: 'html' | 'text') => readFileSync(join(root, 'mail', `${id}.${kind}.hbs`), 'utf8');
            this.mail.set(id, {
                html: html.compile(read('html')),
                text: text.compile(read('text'), { noEscape: true }),
            });
        }
        this.logger.log(`Loaded ${MAIL_TEMPLATE_IDS.length} email template(s) from ${root}`);
    }

    renderMail(id: MailTemplateId, data: Record<string, unknown>): { html: string; text: string } {
        const compiled = this.mail.get(id);
        if (!compiled) throw new Error(`Unknown email template: ${id}`);
        // Handlebars throws on a missing partial but silently prints '' for a missing value,
        // so the processor checks params against the template's schema before calling this.
        return { html: compiled.html(data), text: compiled.text(data).trim() };
    }
}
