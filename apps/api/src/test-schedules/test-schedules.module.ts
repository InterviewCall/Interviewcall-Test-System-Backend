import { Module } from '@nestjs/common';
import { NotificationsModule } from '@app/notifications';
import { TestScheduleRepository } from './test-schedule.repository.js';
import { TestSchedulesController } from './test-schedules.controller.js';
import { TestSchedulesService } from './test-schedules.service.js';

@Module({
    imports: [NotificationsModule],
    controllers: [TestSchedulesController],
    providers: [TestScheduleRepository, TestSchedulesService],
})
export class TestSchedulesModule {}
