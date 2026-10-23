/**
 * The scoring rule, and nothing else. One rule: a correct answer earns the question's marks,
 * a blank or wrong one earns zero, nothing is taken away. Pure, so it is tested without a database.
 */
export interface ScoringQuestion {
    questionVersionId: number;
    topicId: number;
    topic: string;
    marks: number;
    /** The option that is right. This never leaves the server. */
    correctOptionId: number;
}

export interface ScoringAnswer {
    questionVersionId: number;
    selectedOptionId: number | null;
}

export interface SectionScore {
    topicId: number;
    topic: string;
    questions: number;
    answered: number;
    correct: number;
    totalMarks: number;
    obtainedMarks: number;
}

export interface GradedAnswer {
    questionVersionId: number;
    isCorrect: boolean;
    marksAwarded: number;
}

export interface ScoreSummary {
    totalMarks: number;
    obtainedMarks: number;
    /** 0 to 100, two decimals. */
    percentage: number;
    passed: boolean;
    sections: SectionScore[];
    graded: GradedAnswer[];
}

export function scoreAttempt(questions: ScoringQuestion[], answers: ScoringAnswer[], passPercent: number): ScoreSummary {
    const chosen = new Map(answers.map((answer) => [answer.questionVersionId, answer.selectedOptionId]));
    const sections = new Map<number, SectionScore>();
    const graded: GradedAnswer[] = [];
    let totalMarks = 0;
    let obtainedMarks = 0;

    for (const question of questions) {
        const section =
            sections.get(question.topicId) ??
            ({
                topicId: question.topicId,
                topic: question.topic,
                questions: 0,
                answered: 0,
                correct: 0,
                totalMarks: 0,
                obtainedMarks: 0,
            } satisfies SectionScore);
        sections.set(question.topicId, section);

        const selected = chosen.get(question.questionVersionId) ?? null;
        const isCorrect = selected !== null && selected === question.correctOptionId;
        const marksAwarded = isCorrect ? question.marks : 0;

        section.questions += 1;
        section.totalMarks += question.marks;
        section.obtainedMarks += marksAwarded;
        if (selected !== null) section.answered += 1;
        if (isCorrect) section.correct += 1;

        totalMarks += question.marks;
        obtainedMarks += marksAwarded;
        if (chosen.has(question.questionVersionId)) {
            graded.push({ questionVersionId: question.questionVersionId, isCorrect, marksAwarded });
        }
    }

    const percentage = totalMarks > 0 ? Math.round((obtainedMarks / totalMarks) * 10_000) / 100 : 0;
    return {
        totalMarks,
        obtainedMarks,
        percentage,
        // The only place "passed" is decided, on the rounded number that is stored.
        passed: percentage >= passPercent,
        sections: [...sections.values()],
        graded,
    };
}
