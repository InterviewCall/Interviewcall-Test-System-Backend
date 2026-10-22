import { Logger } from '@nestjs/common';
import type { MailProvider, RenderedMail } from '../../types/mail.types.js';

/** Development only: prints the email instead of sending it. The config refuses this driver in production. */
export class ConsoleMailProvider implements MailProvider {
    private readonly logger = new Logger('ConsoleMail');

    send(mail: RenderedMail): Promise<void> {
        this.logger.log(`\n--- email (not sent) ---\nFrom: ${mail.sender} sender\nTo: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text}\n------------------------`);
        return Promise.resolve();
    }
}
