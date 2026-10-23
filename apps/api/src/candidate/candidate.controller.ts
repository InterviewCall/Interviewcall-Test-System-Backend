import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Req, Res, UseGuards, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../common/decorators/public.decorator.js';
import { clientIp, clientUserAgent } from '../common/http/authenticated-request.js';
import { ApiZodBody } from '../common/zod/zod-swagger.js';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe.js';
import { APP_CONFIG } from '../config/app.config.js';
import type { AppConfig } from '../config/types/app-config.types.js';
import { CandidateAccessService } from './candidate-access.service.js';
import { CandidateTestService } from './candidate-test.service.js';
import { CandidateGuard } from './candidate.guard.js';
import {
    createSessionSchema,
    feedbackSchema,
    questionIdParamSchema,
    saveAnswerSchema,
    startAttemptSchema,
} from './candidate.schemas.js';
import type { CreateSessionInput, FeedbackInput, SaveAnswerInput, StartAttemptInput } from './candidate.schemas.js';
import type { AttemptView, CandidateRequest, CandidateTestView } from './types/candidate.types.js';

function cookieOptions(config: AppConfig) {
    return {
        httpOnly: true,
        secure: config.cookie.secure,
        sameSite: config.cookie.sameSite,
        domain: config.cookie.domain,
        path: '/',
    } as const;
}

/**
 * Everything a candidate does. Public for the staff guard; the candidate guard checks their own session.
 * No response here ever says which answer is right or what the score is.
 */
@ApiTags('candidate')
@Public()
@Controller('candidate')
export class CandidateController {
    constructor(
        private readonly access: CandidateAccessService,
        private readonly tests: CandidateTestService,
        @Inject(APP_CONFIG) private readonly config: AppConfig,
    ) {}

    @Post('session')
    @HttpCode(HttpStatus.OK)
    @Throttle({ default: { limit: 10, ttl: 60_000 } })
    @ApiOperation({
        summary: 'Open the test link: swap the secret from the email plus the candidate’s email for a session cookie',
        description: 'Works until the slot ends. After that, or once the test has expired, an advisor or admin has to reschedule it to send a new link.',
    })
    @ApiZodBody(createSessionSchema)
    async createSession(
        @Body(new ZodValidationPipe(createSessionSchema)) dto: CreateSessionInput,
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
    ): Promise<{ ok: true }> {
        const session = await this.access.createSession(dto.token, dto.email, req);
        res.cookie(this.config.cookie.candidateName, session.token, { ...cookieOptions(this.config), expires: session.expiresAt });
        return { ok: true };
    }

    @Delete('session')
    @UseGuards(CandidateGuard)
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Sign out of the test portal' })
    async endSession(@Req() req: CandidateRequest, @Res({ passthrough: true }) res: Response): Promise<void> {
        await this.access.end(req.candidate!.sessionId);
        res.clearCookie(this.config.cookie.candidateName, cookieOptions(this.config));
    }

    @Get('test')
    @UseGuards(CandidateGuard)
    @ApiOperation({ summary: 'The candidate’s test: where they are in it, the window, and what it contains' })
    getTest(@Req() req: CandidateRequest): Promise<CandidateTestView> {
        return this.tests.getTest(req.candidate!);
    }

    @Post('attempt/start')
    @UseGuards(CandidateGuard)
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Start the test, or resume it',
        description: 'The clock starts on the server now. Calling it again returns the same attempt with the same deadline.',
    })
    @ApiZodBody(startAttemptSchema)
    startAttempt(
        @Body(new ZodValidationPipe(startAttemptSchema)) dto: StartAttemptInput,
        @Req() req: CandidateRequest,
    ): Promise<AttemptView> {
        return this.tests.startAttempt(req.candidate!, dto, clientIp(req), clientUserAgent(req));
    }

    @Get('attempt')
    @UseGuards(CandidateGuard)
    @ApiOperation({ summary: 'The questions, saved answers and server deadline. Used to resume after a refresh.' })
    getAttempt(@Req() req: CandidateRequest): Promise<AttemptView> {
        return this.tests.getAttempt(req.candidate!);
    }

    @Put('attempt/answers/:questionVersionId')
    @UseGuards(CandidateGuard)
    @Throttle({ default: { limit: 120, ttl: 60_000 } })
    @ApiOperation({ summary: 'Save the chosen option for one question. Send optionId null to clear it.' })
    @ApiZodBody(saveAnswerSchema)
    saveAnswer(
        @Param('questionVersionId', new ZodValidationPipe(questionIdParamSchema)) questionVersionId: number,
        @Body(new ZodValidationPipe(saveAnswerSchema)) dto: SaveAnswerInput,
        @Req() req: CandidateRequest,
    ): Promise<{ savedAt: Date }> {
        return this.tests.saveAnswer(req.candidate!, questionVersionId, dto);
    }

    @Post('attempt/submit')
    @UseGuards(CandidateGuard)
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Submit the test. Safe to repeat.' })
    submit(@Req() req: CandidateRequest): Promise<{ status: 'SUBMITTED'; submittedAt: Date }> {
        return this.tests.submit(req.candidate!);
    }

    @Post('feedback')
    @UseGuards(CandidateGuard)
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Rate the experience after submitting' })
    @ApiZodBody(feedbackSchema)
    async feedback(@Body(new ZodValidationPipe(feedbackSchema)) dto: FeedbackInput, @Req() req: CandidateRequest): Promise<void> {
        await this.tests.sendFeedback(req.candidate!, dto);
    }
}
