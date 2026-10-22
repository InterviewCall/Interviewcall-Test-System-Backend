import { Logger } from '@nestjs/common';
import type { WhatsAppMessage, WhatsAppProvider } from '../../types/whatsapp.types.js';

/** Development only: prints the message instead of sending it. The config refuses this driver in production. */
export class ConsoleWhatsAppProvider implements WhatsAppProvider {
    private readonly logger = new Logger('ConsoleWhatsApp');

    send(message: WhatsAppMessage): Promise<void> {
        this.logger.log(
            `\n--- whatsapp (not sent) ---\nTo: ${message.destination} (${message.userName})\nCampaign: ${message.campaignName}\nParams: ${JSON.stringify(message.templateParams)}\n---------------------------`,
        );
        return Promise.resolve();
    }
}
