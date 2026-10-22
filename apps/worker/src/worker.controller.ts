import { Controller, Get } from '@nestjs/common';
import { WorkerService } from './worker.service.js';

@Controller()
export class WorkerController {
  constructor(private readonly workerService: WorkerService) {}

  @Get()
  getHello(): string {
    return this.workerService.getHello();
  }
}
