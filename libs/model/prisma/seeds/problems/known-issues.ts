/**
 * Things found in the exported questions when they were checked before seeding.
 */

/**
 * Answers that were wrong in the export, corrected when the question is seeded. Each one was checked
 * by working the question out (or by brute force), and the reason is printed when the seed runs, so
 * the change is never silent. Matching is by exact text; a correction that no longer applies to
 * the data stops the seed instead of passing quietly.
 */
export interface Correction {
    reason: string;
    /** Option texts to replace: the right answer was not among the options, so the wrong option becomes it. */
    options?: { from: string; to: string }[];
    /** The option that is the right answer, after the replacements above. */
    correctOption?: string;
    /** Exact text to replace in every code stub. */
    code?: { from: string; to: string }[];
}

export const CORRECTIONS: Readonly<Record<string, Correction>> = {
    ENTRDP1: {
        reason:
            'The code only stopped at n == 0, but for n = 7 the calls go 7, 5, 3, 1, -1 and never reach 0, so it never ended. Stopping at n <= 1 makes the stored answer, 105 (7 x 5 x 3 x 1), correct.',
        code: [
            { from: 'n == 0', to: 'n <= 1' },
            { from: 'n === 0', to: 'n <= 1' },
        ],
    },
    ENTPC2: {
        reason:
            'Same colour: C(4,2) + C(5,2) + C(6,2) = 31 out of C(15,2) = 105. The stored answer 2/5 was wrong and 31/105 was not an option, so the 2/5 option is now 31/105.',
        options: [{ from: '2/5', to: '31/105' }],
        correctOption: '31/105',
    },
    ENTSM1: {
        reason:
            'Six words start with E, then HELP is the first starting with H, so its rank is 7. The stored answer 13 was wrong and 7 was not an option, so the 13 option is now 7.',
        options: [{ from: '13', to: '7' }],
        correctOption: '7',
    },
    ETADP2: {
        reason:
            'Two moves are enough: repaint the 2 2 2 block to 3, then the whole block of 3s to 1. A search over every move sequence confirms 2 is the minimum. The key said 3; the option "2" is now the correct one.',
        correctOption: '2',
    },
};

/** Copy-paste leftovers, fixed by exact text so nothing else is touched. */
export const TEXT_FIXES: readonly { code: string; from: string; to: string }[] = [
    // A maths-font copy of the symbol pasted in front of the plain one.
    { code: 'ETAGA1', from: '  𝜇 ( 𝐺 ) μ(G)', to: ' μ(G)' },
    // A stray backtick on its own line after the question.
    { code: 'ETAMO1', from: '\n`\n', to: '\n' },
];
