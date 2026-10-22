import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module.js';

async function bootstrap() {
  const app = await NestFactory.create(WorkerModule);
  await app.listen(process.env.WORKER_PORT ?? 3001);
}
await bootstrap();
