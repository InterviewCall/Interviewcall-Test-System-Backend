import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ApiModule } from './api.module.js';

async function bootstrap() {
  const app = await NestFactory.create(ApiModule);
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
