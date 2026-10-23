import { z } from 'zod';
import { SubmitReason, TestLevel } from '@app/prisma';

// Response shape. It documents the API (and generates the console's types); it is not run against responses.
const dateTime = z.string().meta({ format: 'date-time' });

const reportQuestionSchema = z.object({
    questionVersionId: z.number().int(),
    code: z.string().describe('The question’s code, such as ETATA1. For staff only'),
    number: z.number().int().describe('Position inside its topic, in the order the candidate saw'),
    status: z.enum(['correct', 'wrong', 'blank']),
    marks: z.number().int(),
    totalMarks: z.number().int(),
    statementMd: z.string(),
    codeStubs: z
        .array(z.object({ language: z.string(), label: z.string(), code: z.string() }))
        .nullable()
        .describe('The code the question refers to, one entry per language. Null when the question has none'),
    options: z.array(
        z.object({
            id: z.number().int(),
            textMd: z.string(),
            isCorrect: z.boolean(),
            chosen: z.boolean().describe('The option the candidate picked'),
        }),
    ),
});

export const testReportResponseSchema = z.object({
    scheduleId: z.number().int(),
    level: z.enum(TestLevel),
    candidate: z.object({
        fullName: z.string(),
        email: z.string(),
        phone: z.string().nullable(),
        workExperienceYears: z.number(),
    }),
    advisor: z.string(),
    template: z.object({
        name: z.string(),
        version: z.number().int(),
        durationMinutes: z.number().int(),
        passPercent: z.number().int(),
    }),
    attempt: z.object({
        startedAt: dateTime,
        submittedAt: dateTime,
        submitReason: z.enum(SubmitReason).describe('CANDIDATE pressed Submit; TIMEOUT means the server submitted at the deadline'),
    }),
    result: z.object({
        totalMarks: z.number().int(),
        obtainedMarks: z.number().int(),
        percentage: z.number().describe('0 to 100, two decimals'),
        passed: z.boolean(),
    }),
    topics: z.array(
        z.object({
            topic: z.string(),
            questions: z.number().int(),
            answered: z.number().int(),
            correct: z.number().int(),
            totalMarks: z.number().int(),
            obtainedMarks: z.number().int(),
            items: z.array(reportQuestionSchema),
        }),
    ),
});
