import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator.js';
import { MailEventsService } from './mail-events.service.js';

/**
 * Where SNS posts SES's delivery reports. Public on purpose: SNS has no session, so every message is
 * checked against AWS's signature instead (see SnsVerifier). Not in the API docs: it is not for clients.
 */
@ApiExcludeController()
@Public()
@SkipThrottle()
@Controller('mail-events')
export class MailEventsController {
    constructor(private readonly events: MailEventsService) {}

    @Post('ses')
    @HttpCode(HttpStatus.OK)
    async ses(@Body() body: unknown): Promise<{ ok: true }> {
        await this.events.handle(body);
        return { ok: true };
    }
}
