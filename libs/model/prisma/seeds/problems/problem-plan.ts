import type { TestLevel } from '../../../src/generated/prisma/enums.js';
import { CORRECTIONS, TEXT_FIXES } from './known-issues.js';
import type { ProblemFile, SourceQuestion } from './problem-file.schema.js';

export type LanguageKey = 'cpp' | 'java' | 'javascript' | 'python';

/**
 * The export labels the Java stub "cpp" (a copy-paste slip in the old tool), so the language is
 * taken from the label, which was always right.
 */
const LANGUAGE_BY_LABEL: Readonly<Record<string, LanguageKey>> = {
    'C++': 'cpp',
    Java: 'java',
    Javascript: 'javascript',
    Python: 'python',
};

/** Same numbers as TEST_DURATION_MINUTES in the API; a unit test keeps the two in step. */
export const TEMPLATE_RULES = {
    INTERMEDIATE: { code: 'intermediate', name: 'Intermediate entrance test', durationMinutes: 22, passPercent: 50 },
    ADVANCED: { code: 'advanced', name: 'Advanced entrance test', durationMinutes: 12, passPercent: 50 },
} as const satisfies Record<TestLevel, { code: string; name: string; durationMinutes: number; passPercent: number }>;

export interface PlannedOption {
    position: number;
    textMd: string;
    isCorrect: boolean;
}

export interface PlannedQuestion {
    legacyId: string;
    /** The old problemTitle, such as ENTTCAA1. */
    code: string;
    topic: string;
    level: TestLevel;
    /** The old questionNumber: the order within the level. */
    order: number;
    statementMd: string;
    marks: number;
    options: PlannedOption[];
    codeStubs: { language: LanguageKey; label: string; code: string }[] | null;
    /** Why the answer or wording differs from the export, when it had to be corrected. */
    corrected: string | null;
}

export interface PlannedSection {
    topic: string;
    questions: PlannedQuestion[];
}

export interface PlannedTemplate {
    level: TestLevel;
    code: string;
    name: string;
    durationMinutes: number;
    passPercent: number;
    sections: PlannedSection[];
}

export interface ProblemPlan {
    topics: string[];
    questions: PlannedQuestion[];
    templates: PlannedTemplate[];
}

const LEVEL: Record<'Intermediate' | 'Advanced', TestLevel> = { Intermediate: 'INTERMEDIATE', Advanced: 'ADVANCED' };

function applyFixes(code: string, text: string): string {
    return TEXT_FIXES.filter((fix) => fix.code === code).reduce((out, fix) => out.replace(fix.from, fix.to), text);
}

function planQuestion(source: SourceQuestion, topic: string, level: TestLevel): PlannedQuestion {
    const code = source.problemTitle;
    const correction = CORRECTIONS[code];

    // Corrections first, so that everything below checks the corrected question.
    const sourceOptions = source.options.map((text) => {
        const swap = correction?.options?.find((change) => change.from === text);
        return swap ? swap.to : text;
    });
    for (const change of correction?.options ?? []) {
        if (!source.options.includes(change.from)) throw new Error(`${code}: correction expects an option "${change.from}", which is not in the export`);
    }
    const correctText = correction?.correctOption ?? source.correctOption;
    const options = sourceOptions.map((text) => applyFixes(code, text).trim());

    // The old system stored the right answer as the option's text. Turn it into a flag on exactly one option.
    const matches = sourceOptions.map((text, index) => (text === correctText ? index : -1)).filter((i) => i >= 0);
    if (matches.length !== 1) {
        throw new Error(
            `${code}: the correct answer must match exactly one option, but it matches ${matches.length} (${JSON.stringify(correctText)})`,
        );
    }
    if (new Set(options).size !== options.length) throw new Error(`${code}: two options have the same text`);

    const codeStubs = (source.codeStubs ?? []).map((stub) => {
        const language = LANGUAGE_BY_LABEL[stub.label];
        if (!language) throw new Error(`${code}: unknown code stub language "${stub.label}"`);
        let text = stub.code;
        for (const change of correction?.code ?? []) text = text.replaceAll(change.from, change.to);
        return { language, label: stub.label, code: text };
    });
    for (const change of correction?.code ?? []) {
        if (!(source.codeStubs ?? []).some((stub) => stub.code.includes(change.from))) {
            throw new Error(`${code}: correction expects "${change.from}" in the code, which is not there`);
        }
    }
    if (new Set(codeStubs.map((stub) => stub.language)).size !== codeStubs.length) {
        throw new Error(`${code}: two code stubs for the same language`);
    }

    return {
        legacyId: source._id.$oid,
        code,
        topic,
        level,
        order: source.questionNumber,
        statementMd: applyFixes(code, source.problemStatement).trimEnd(),
        marks: source.marks,
        options: options.map((textMd, index) => ({ position: index + 1, textMd, isCorrect: index === matches[0] })),
        codeStubs: codeStubs.length > 0 ? codeStubs : null,
        corrected: correction?.reason ?? null,
    };
}

/**
 * Turns the exported file into what should exist in the database. Pure: it reads nothing and writes
 * nothing, so it can be tested without a database. Throws on any problem with the data rather
 * than seeding something half right.
 */
export function planProblems(file: ProblemFile): ProblemPlan {
    const questions: PlannedQuestion[] = [];
    const topics: string[] = [];
    const sectionsByLevel = new Map<TestLevel, Map<string, PlannedQuestion[]>>();

    for (const document of file) {
        const level = LEVEL[document.problemLevel];
        const topic = document.problemTopic.trim();
        if (!topics.includes(topic)) topics.push(topic);

        const sections = sectionsByLevel.get(level) ?? new Map<string, PlannedQuestion[]>();
        sectionsByLevel.set(level, sections);
        const inSection = sections.get(topic) ?? [];
        sections.set(topic, inSection);

        for (const source of document.problemDescription) {
            const planned = planQuestion(source, topic, level);
            questions.push(planned);
            inSection.push(planned);
        }
    }

    const ids = new Set<string>();
    const codes = new Set<string>();
    for (const question of questions) {
        if (ids.has(question.legacyId)) throw new Error(`${question.code}: its _id appears twice in the file`);
        if (codes.has(question.code)) throw new Error(`${question.code}: its title appears twice in the file`);
        ids.add(question.legacyId);
        codes.add(question.code);
    }

    const templates = (Object.keys(TEMPLATE_RULES) as TestLevel[]).map((level) => ({
        level,
        ...TEMPLATE_RULES[level],
        sections: [...(sectionsByLevel.get(level) ?? new Map<string, PlannedQuestion[]>()).entries()]
            .filter(([, inSection]) => inSection.length > 0)
            .map(([topic, inSection]) => ({ topic, questions: [...inSection].sort((a, b) => a.order - b.order) })),
    }));

    return { topics, questions, templates };
}
