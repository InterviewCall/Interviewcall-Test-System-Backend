import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TEST_DURATION_MINUTES } from '../../../../../apps/api/src/test-schedules/test-levels.js';
import { CORRECTIONS } from './known-issues.js';
import { problemFileSchema } from './problem-file.schema.js';
import { planProblems, TEMPLATE_RULES } from './problem-plan.js';

const file = fileURLToPath(new URL('../../../../../interviewcall.problems.json', import.meta.url));
const load = () => problemFileSchema.parse(JSON.parse(readFileSync(file, 'utf8')));

describe('problem export plan', () => {
    const plan = planProblems(load());
    const byCode = (code: string) => plan.questions.find((q) => q.code === code)!;

    it('reads every question in the export', () => {
        expect(plan.questions).toHaveLength(32);
        expect(plan.topics).toHaveLength(16);
        expect(plan.questions.filter((q) => q.level === 'INTERMEDIATE')).toHaveLength(20);
        expect(plan.questions.filter((q) => q.level === 'ADVANCED')).toHaveLength(12);
    });

    it('marks exactly one option correct, and it is the one whose text was the stored answer', () => {
        for (const question of plan.questions) {
            expect(question.options).toHaveLength(4);
            expect(question.options.filter((o) => o.isCorrect)).toHaveLength(1);
            expect(question.options.map((o) => o.position)).toEqual([1, 2, 3, 4]);
        }
        expect(byCode('ENTTCAA2').options.find((o) => o.isCorrect)?.textMd).toBe('2450');
        expect(byCode('ETATA1').options.find((o) => o.isCorrect)?.textMd).toBe('Persistent Segment Tree combined with LCA');
    });

    it('takes the stub language from the label, so Java is java', () => {
        const stubs = byCode('ENTTCAA1').codeStubs!;
        expect(stubs.map((s) => [s.label, s.language])).toEqual([
            ['C++', 'cpp'],
            ['Java', 'java'],
            ['Javascript', 'javascript'],
            ['Python', 'python'],
        ]);
        expect(byCode('ENTSS1').codeStubs).toBeNull();
    });

    it('puts every question in its level’s template', () => {
        const intermediate = plan.templates.find((t) => t.level === 'INTERMEDIATE')!;
        const advanced = plan.templates.find((t) => t.level === 'ADVANCED')!;
        expect(intermediate.sections.flatMap((s) => s.questions)).toHaveLength(20);
        expect(advanced.sections.flatMap((s) => s.questions)).toHaveLength(12);
        expect(intermediate.sections).toHaveLength(10);
        expect(advanced.sections).toHaveLength(6);
    });

    it('corrects the four answers that were wrong, and says why', () => {
        expect(Object.keys(CORRECTIONS).sort()).toEqual(['ENTPC2', 'ENTRDP1', 'ENTSM1', 'ETADP2']);
        for (const code of Object.keys(CORRECTIONS)) expect(byCode(code).corrected).toBeTruthy();

        const rightAnswer = (code: string) => byCode(code).options.find((o) => o.isCorrect)?.textMd;
        expect(rightAnswer('ENTPC2')).toBe('31/105');
        expect(rightAnswer('ENTSM1')).toBe('7');
        expect(rightAnswer('ETADP2')).toBe('2');
        expect(rightAnswer('ENTRDP1')).toBe('105');
        // Only the wrong option was replaced; the others are as exported.
        expect(byCode('ENTPC2').options.map((o) => o.textMd)).toEqual(['1/3', '31/105', '1/2', '1/4']);
        expect(byCode('ENTSM1').options.map((o) => o.textMd)).toEqual(['24', '7', '15', '18']);
        // The recursion now stops, in all four languages.
        for (const stub of byCode('ENTRDP1').codeStubs!) expect(stub.code).toMatch(/n <= 1/);
        expect(byCode('ENTTCAA1').corrected).toBeNull();
    });

    it('computes what the corrected questions claim', () => {
        const mystery = (n: number): number => (n <= 1 ? 1 : n * mystery(n - 2));
        expect(mystery(7)).toBe(105);
        const choose = (n: number, k: number): number => (k === 0 ? 1 : (choose(n - 1, k - 1) * n) / k);
        expect(choose(4, 2) + choose(5, 2) + choose(6, 2)).toBe(31);
        expect(choose(15, 2)).toBe(105);
    });

    it('builds sections in the old order and questions by question number', () => {
        const intermediate = plan.templates.find((t) => t.level === 'INTERMEDIATE')!;
        expect(intermediate.sections[0]?.topic).toBe('Time Complexity & Algorithm Analysis');
        for (const section of plan.templates.flatMap((t) => t.sections)) {
            const orders = section.questions.map((q) => q.order);
            expect(orders).toEqual([...orders].sort((a, b) => a - b));
        }
    });

    it('cleans the two copy-paste leftovers and nothing else', () => {
        expect(byCode('ETAGA1').options[1]?.textMd).toBe('If all edge weights are integers, then μ(G) must also be an integer.');
        expect(byCode('ETAMO1').statementMd.endsWith('using Mo’s Algorithm?**')).toBe(true);
    });

    it('uses the same durations as the scheduling API', () => {
        expect(TEMPLATE_RULES.INTERMEDIATE.durationMinutes).toBe(TEST_DURATION_MINUTES.INTERMEDIATE);
        expect(TEMPLATE_RULES.ADVANCED.durationMinutes).toBe(TEST_DURATION_MINUTES.ADVANCED);
    });

    it('refuses an answer that matches no option, rather than seeding a broken question', () => {
        const broken = load();
        broken[0]!.problemDescription[0]!.correctOption = 'not an option';
        expect(() => planProblems(broken)).toThrow(/exactly one option/);
    });

    it('refuses a repeated question id', () => {
        const twice = load();
        twice[1]!.problemDescription[0]!._id = twice[0]!.problemDescription[0]!._id;
        expect(() => planProblems(twice)).toThrow(/appears twice/);
    });
});
