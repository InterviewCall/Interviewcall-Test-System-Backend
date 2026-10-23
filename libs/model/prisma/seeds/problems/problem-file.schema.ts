import { z } from 'zod';

/**
 * The shape of interviewcall.problems.json, exported from the old MongoDB `problems` collection:
 * one document per topic, with that topic's questions embedded. Anything else in a document
 * (createdAt, __v) is ignored. A file that does not match stops the seed before it writes anything.
 */
const oid = z.object({ $oid: z.string().regex(/^[0-9a-f]{24}$/, 'not a MongoDB ObjectId') });

const codeStub = z.object({
    label: z.string().min(1),
    code: z.string(),
});

const question = z.object({
    _id: oid,
    problemTitle: z.string().min(1).max(150),
    problemStatement: z.string().min(1),
    codeStubs: z.array(codeStub).nullish(),
    options: z.array(z.string().min(1)).min(2).max(8),
    correctOption: z.string().min(1),
    marks: z.number().int().min(0),
    questionNumber: z.number().int().min(1),
});

const topicDocument = z.object({
    _id: oid,
    problemTopic: z.string().min(1).max(100),
    problemLevel: z.enum(['Intermediate', 'Advanced']),
    problemDescription: z.array(question).min(1),
});

export const problemFileSchema = z.array(topicDocument).min(1);

export type ProblemFile = z.infer<typeof problemFileSchema>;
export type SourceQuestion = z.infer<typeof question>;
