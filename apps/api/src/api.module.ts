import { Module } from '@nestjs/common';
import { ModelModule } from '@app/model';
import { ApiController } from './api.controller.js';
import { ApiService } from './api.service.js';

@Module({
    imports: [ModelModule],
    controllers: [ApiController],
    providers: [ApiService],
})
export class ApiModule {}
