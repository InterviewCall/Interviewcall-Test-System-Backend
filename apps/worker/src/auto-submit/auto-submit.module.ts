import { Module } from '@nestjs/common';
import { AutoSubmitService } from './auto-submit.service.js';

@Module({ providers: [AutoSubmitService] })
export class AutoSubmitModule {}
