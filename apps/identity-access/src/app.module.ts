import { Module } from '@nestjs/common';
import { ModelModule } from '@app/model';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

@Module({
    imports: [ModelModule],
    controllers: [AppController],
    providers: [AppService],
})
export class AppModule {}
