export interface AppConfig {
    nodeEnv: string;
    isProduction: boolean;
    port: number;
    /** Number of reverse proxies in front of the API (Next rewrite, load balancer). */
    trustProxyHops: number;
    /** Browser origins allowed to send state-changing requests. */
    allowedOrigins: string[];
    swaggerEnabled: boolean;
    cookie: {
        name: string;
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
