import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module.js';

// No HTTP server: this process only consumes queues. The Redis connections keep it alive,
// and SIGTERM/SIGINT let running jobs finish before it exits.
async function bootstrap() {
    const app = await NestFactory.createApplicationContext(WorkerModule);
    app.enableShutdownHooks();
    new Logger('Worker').log('Worker started: waiting for notification jobs');
}
await bootstrap();
