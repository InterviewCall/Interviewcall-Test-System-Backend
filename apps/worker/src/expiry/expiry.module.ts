import { Module } from '@nestjs/common';
import { ExpiryService } from './expiry.service.js';

@Module({ providers: [ExpiryService] })
export class ExpiryModule {}
