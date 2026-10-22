import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { originCheck } from './common/http/origin-check.js';
import type { AppConfig } from './config/types/app-config.types.js';

export const API_PREFIX = 'api/v1';

/** Everything main.ts and the e2e tests must share, so tests run the real pipeline. */
export function configureApp(app: NestExpressApplication, config: AppConfig): void {
    if (config.trustProxyHops > 0) app.set('trust proxy', config.trustProxyHops);

    // The Swagger UI needs inline scripts; the JSON API does not care about CSP.
    app.use(helmet({ contentSecurityPolicy: config.swaggerEnabled ? false : undefined }));
    app.use(cookieParser());
    app.use(originCheck(config.allowedOrigins));

    app.setGlobalPrefix(API_PREFIX);
    app.enableShutdownHooks();
}

export function setupSwagger(app: NestExpressApplication, config: AppConfig): void {
    if (!config.swaggerEnabled) return;

    const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder()
            .setTitle('InterviewCall Entrance Test API')
            .setVersion('1.0')
            .addCookieAuth(config.cookie.name)
            .build(),
    );
    SwaggerModule.setup('api/docs', app, document, { jsonDocumentUrl: 'api/docs-json' });
}
