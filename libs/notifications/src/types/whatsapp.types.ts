/** One approved AiSensy campaign message, ready to deliver. */
export interface WhatsAppMessage {
    /** The live AiSensy campaign (template) to send. */
    campaignName: string;
    /** E.164, e.g. +917044610338. */
    destination: string;
    userName: string;
    /** Positional values for the campaign's {{1}}, {{2}}, ... The count must match the campaign. */
    templateParams: string[];
}

export interface WhatsAppProvider {
    send(message: WhatsAppMessage): Promise<void>;
}

export const WHATSAPP_PROVIDER = Symbol('WHATSAPP_PROVIDER');
