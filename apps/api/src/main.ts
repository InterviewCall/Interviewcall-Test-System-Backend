import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ApiModule } from './api.module.js';
import { configureApp, setupSwagger } from './app.setup.js';
import { loadConfig } from './config/app.config.js';

async function bootstrap() {
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(ApiModule);
  configureApp(app, config);
  setupSwagger(app, config);
  await app.listen(config.port);
}
await bootstrap();
