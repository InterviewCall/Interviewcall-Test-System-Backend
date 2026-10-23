import { readFileSync } from 'node:fs';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';
import { PublishStatus, QuestionType } from '../../../src/generated/prisma/enums.js';
import { problemFileSchema } from './problem-file.schema.js';
import { planProblems } from './problem-plan.js';

export interface SeedProblemsResult {
    topicsCreated: number;
    questionsCreated: number;
    questionsAlreadyThere: number;
    templatesCreated: number;
    templatesAlreadyThere: number;
    corrected: { code: string; reason: string }[];
}

/**
 * Loads the old question export into the new question bank and builds the two test templates from it.
 *
 * Safe to run again: a question that is already in the bank (matched by its old MongoDB id) is left
 * exactly as it is, so nothing staff have edited since is overwritten, and a template version that
 * exists is never touched, because published versions are frozen. Everything happens in one
 * transaction, so a failure leaves the database as it was.
 */
export async function seedProblems(prisma: PrismaClient, filePath: string): Promise<SeedProblemsResult> {
    const parsed = problemFileSchema.safeParse(JSON.parse(readFileSync(filePath, 'utf8')));
    if (!parsed.success) {
        const first = parsed.error.issues[0];
        throw new Error(`${filePath} is not a valid problems export: ${first?.path.join('.')} ${first?.message}`);
    }
    const plan = planProblems(parsed.data);

    const result: SeedProblemsResult = {
        topicsCreated: 0,
        questionsCreated: 0,
        questionsAlreadyThere: 0,
        templatesCreated: 0,
        templatesAlreadyThere: 0,
        corrected: plan.questions.filter((q) => q.corrected).map((q) => ({ code: q.code, reason: q.corrected as string })),
    };

    await prisma.$transaction(
        async (tx) => {
            const topicIds = new Map<string, number>();
            for (const name of plan.topics) {
                const existing = await tx.topic.findUnique({ where: { name }, select: { id: true } });
                if (existing) {
                    topicIds.set(name, existing.id);
                } else {
                    topicIds.set(name, (await tx.topic.create({ data: { name }, select: { id: true } })).id);
                    result.topicsCreated += 1;
                }
            }

            // legacy id -> the version a template should point at
            const versionIds = new Map<string, number>();
            for (const question of plan.questions) {
                const existing = await tx.question.findUnique({
                    where: { legacyId: question.legacyId },
                    select: { versions: { orderBy: { version: 'desc' }, take: 1, select: { id: true } } },
                });
                if (existing) {
                    result.questionsAlreadyThere += 1;
                    const latest = existing.versions[0];
                    if (latest) versionIds.set(question.legacyId, latest.id);
                    continue;
                }

                const created = await tx.question.create({
                    data: {
                        topicId: topicIds.get(question.topic) as number,
                        type: QuestionType.MCQ,
                        status: PublishStatus.PUBLISHED,
                        legacyId: question.legacyId,
                        versions: {
                            create: {
                                version: 1,
                                title: question.code,
                                statementMd: question.statementMd,
                                codeStubs: question.codeStubs ?? undefined,
                                marks: question.marks,
                                options: { create: question.options },
                            },
                        },
                    },
                    select: { versions: { select: { id: true } } },
                });
                result.questionsCreated += 1;
                versionIds.set(question.legacyId, (created.versions[0] as { id: number }).id);
            }

            for (const template of plan.templates) {
                const record = await tx.testTemplate.upsert({
                    where: { code: template.code },
                    create: { code: template.code, name: template.name, level: template.level },
                    update: {},
                    select: { id: true },
                });
                const frozen = await tx.templateVersion.findUnique({
                    where: { templateId_version: { templateId: record.id, version: 1 } },
                    select: { id: true },
                });
                if (frozen) {
                    result.templatesAlreadyThere += 1;
                    continue;
                }

                await tx.templateVersion.create({
                    data: {
                        templateId: record.id,
                        version: 1,
                        durationMinutes: template.durationMinutes,
                        passPercent: template.passPercent,
                        status: PublishStatus.PUBLISHED,
                        publishedAt: new Date(),
                        sections: {
                            create: template.sections.map((section, sectionIndex) => ({
                                topicId: topicIds.get(section.topic) as number,
                                position: sectionIndex + 1,
                                scored: true,
                                questions: {
                                    create: section.questions.map((question, questionIndex) => ({
                                        questionVersionId: versionIds.get(question.legacyId) as number,
                                        position: questionIndex + 1,
                                    })),
                                },
                            })),
                        },
                    },
                });
                result.templatesCreated += 1;
            }
        },
        { timeout: 60_000, maxWait: 10_000 },
    );

    return result;
}

export function describeResult(result: SeedProblemsResult): string {
    const lines = [
        `Questions: ${result.questionsCreated} added, ${result.questionsAlreadyThere} already in the bank (left as they are). Topics added: ${result.topicsCreated}.`,
        `Templates: ${result.templatesCreated} created, ${result.templatesAlreadyThere} already there (left as they are).`,
    ];
    if (result.corrected.length > 0 && result.questionsCreated > 0) {
        lines.push(
            `${result.corrected.length} question(s) had a wrong answer or broken code in the export and were corrected as they were added:`,
            ...result.corrected.map((item) => `  - ${item.code}: ${item.reason}`),
        );
    }
    return lines.join('\n');
}
