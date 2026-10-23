export interface AppConfig {
    nodeEnv: string;
    isProduction: boolean;
    port: number;
    /** Number of reverse proxies in front of the API (Next rewrite, load balancer). */
    trustProxyHops: number;
    /** Browser origins allowed to send state-changing requests. */
    allowedOrigins: string[];
    swaggerEnabled: boolean;
    mailEvents: {
        /**
         * The SNS topic SES publishes its delivery reports to. Only messages from this topic are accepted.
         * Not set: the webhook is switched off and invitation emails stay at "queued".
         */
        topicArn: string | undefined;
    };
    cookie: {
        name: string;
        /** The candidate's cookie. A different name, so a staff member testing the flow never signs themselves out. */
        candidateName: string;
        secure: boolean;
        sameSite: 'lax' | 'strict';
        domain: string | undefined;
    };
    session: {
        /** Sliding idle timeout. */
        idleMinutes: number;
        /** Hard cap from login, however active the user is. */
        absoluteDays: number;
        /** lastSeenAt/expiresAt are written at most this often. */
        touchIntervalMinutes: number;
    };
}
