import { SubmitReason, TestLevel } from '@app/prisma';
import { buildReport } from './build-report.js';
import type { ReportSource } from './build-report.js';

const question = (id: number, title: string, correct: number) => ({
    id,
    title,
    statementMd: `Statement of ${title}`,
    codeStubs: null as unknown,
    marks: 5,
    options: [
        { id: id * 10 + 1, textMd: 'A', isCorrect: correct === 1, position: 1 },
        { id: id * 10 + 2, textMd: 'B', isCorrect: correct === 2, position: 2 },
    ],
});

const source: ReportSource = {
    scheduleId: 7,
    level: TestLevel.ADVANCED,
    advisor: 'Priya Nair',
    candidate: { fullName: 'Rohan Das', email: 'rohan@example.com', phone: null },
    attempt: {
        startedAt: new Date('2026-10-24T05:30:00Z'),
        submittedAt: new Date('2026-10-24T05:40:00Z'),
        submitReason: SubmitReason.CANDIDATE,
        workExperienceYears: 3.5,
        // Shown in this order: 3, 1, 2 (topic Trees: 1,2; topic Bits: 3) then a survey question 9.
        questionOrder: [3, 1, 2, 9],
        answers: [
            { questionVersionId: 1, selectedOptionId: 11, isCorrect: true, marksAwarded: 5 },
            { questionVersionId: 2, selectedOptionId: 21, isCorrect: false, marksAwarded: 0 },
            { questionVersionId: 3, selectedOptionId: null, isCorrect: null, marksAwarded: null },
        ],
        template: {
            name: 'Advanced',
            version: 1,
            durationMinutes: 12,
            passPercent: 50,
            sections: [
                { topic: 'Trees', questionVersionIds: [1, 2] },
                { topic: 'Bits', questionVersionIds: [3] },
            ],
        },
    },
    result: { totalMarks: 15, obtainedMarks: 5, percentage: 33.33, passed: false },
    questions: [question(1, 'T1', 1), question(2, 'T2', 2), question(3, 'B1', 1)],
};

describe('buildReport', () => {
    const report = buildReport(source);

    it('groups the review by topic in template order, questions in the order the candidate saw', () => {
        expect(report.topics.map((t) => t.topic)).toEqual(['Trees', 'Bits']);
        expect(report.topics[0]!.items.map((i) => [i.code, i.number])).toEqual([['T1', 1], ['T2', 2]]);
    });

    it('marks each answer correct, wrong or blank from what was graded', () => {
        const [t1, t2] = report.topics[0]!.items;
        expect([t1!.status, t2!.status, report.topics[1]!.items[0]!.status]).toEqual(['correct', 'wrong', 'blank']);
    });

    it('shows which option was chosen and which is right', () => {
        const wrong = report.topics[0]!.items[1]!;
        expect(wrong.options.find((o) => o.chosen)!.id).toBe(21);
        expect(wrong.options.find((o) => o.isCorrect)!.id).toBe(22);
        expect(report.topics[1]!.items[0]!.options.some((o) => o.chosen)).toBe(false);
    });

    it('adds up each topic and leaves unscored questions out', () => {
        expect(report.topics[0]).toMatchObject({ questions: 2, answered: 2, correct: 1, totalMarks: 10, obtainedMarks: 5 });
        expect(report.topics[1]).toMatchObject({ questions: 1, answered: 0, correct: 0, totalMarks: 5, obtainedMarks: 0 });
        expect(report.topics.flatMap((t) => t.items).map((i) => i.questionVersionId)).not.toContain(9);
    });

    it('carries the stored result and the template facts it was scored against', () => {
        expect(report.result).toEqual(source.result);
        expect(report.template).toEqual({ name: 'Advanced', version: 1, durationMinutes: 12, passPercent: 50 });
        expect(report.candidate.workExperienceYears).toBe(3.5);
    });

    it('carries a question’s code, keeping only entries that have some', () => {
        const withCode: ReportSource = {
            ...source,
            questions: source.questions.map((q) =>
                q.id === 1
                    ? {
                          ...q,
                          codeStubs: [
                              { language: 'cpp', label: 'C++', code: 'int main() {}' },
                              { language: 'java', label: 'Java', code: '   ' },
                              'junk',
                              { code: 'print(1)' },
                          ],
                      }
                    : q,
            ),
        };
        const items = buildReport(withCode).topics.flatMap((t) => t.items);
        expect(items.find((i) => i.questionVersionId === 1)!.codeStubs).toEqual([
            { language: 'cpp', label: 'C++', code: 'int main() {}' },
            { language: 'code', label: 'code', code: 'print(1)' },
        ]);
        expect(items.find((i) => i.questionVersionId === 2)!.codeStubs).toBeNull();
    });
});
