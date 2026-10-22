import { NotificationDeliveryError } from '../../errors/notification-delivery.error.js';
import type { NotificationsConfig } from '../../types/notifications-config.types.js';
import type { WhatsAppMessage, WhatsAppProvider } from '../../types/whatsapp.types.js';

const TIMEOUT_MS = 15_000;

/**
 * Sends an approved template message through AiSensy's Campaign API.
 * https://aisensy.com/docs/api-docs/api-reference-docs/
 */
export class AiSensyProvider implements WhatsAppProvider {
    constructor(
        private readonly settings: NotificationsConfig['whatsapp'],
        private readonly fetchImpl: typeof fetch = fetch,
    ) {}

    async send(message: WhatsAppMessage): Promise<void> {
        let response: Response;
        try {
            response = await this.fetchImpl(this.settings.apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apiKey: this.settings.apiKey,
                    campaignName: message.campaignName,
                    destination: message.destination,
                    userName: message.userName,
                    source: this.settings.source,
                    templateParams: message.templateParams,
                }),
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
        } catch (error) {
            // Timeout or no connection: nothing reached AiSensy, so another attempt is safe.
            throw new NotificationDeliveryError(
                `AiSensy request failed: ${error instanceof Error ? error.message : String(error)}`,
                true,
                { cause: error },
            );
        }

        if (response.ok) return;

        // The body can say why ("campaign not live", "template params mismatch"). Never echoes our key.
        const detail = (await response.text().catch(() => '')).slice(0, 300);
        const retryable = response.status === 429 || response.status >= 500;
        throw new NotificationDeliveryError(`AiSensy responded ${response.status}: ${detail}`, retryable);
    }
}
