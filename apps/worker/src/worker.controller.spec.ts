import { Test, TestingModule } from '@nestjs/testing';
import { WorkerController } from './worker.controller.js';
import { WorkerService } from './worker.service.js';

describe('WorkerController', () => {
  let workerController: WorkerController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [WorkerController],
      providers: [WorkerService],
    }).compile();

    workerController = app.get<WorkerController>(WorkerController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(workerController.getHello()).toBe('Hello World!');
    });
  });
});
