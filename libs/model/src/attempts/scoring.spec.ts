import { scoreAttempt } from './scoring.js';
import type { ScoringQuestion } from './scoring.js';

const q = (id: number, topicId: number, correct: number, marks = 5): ScoringQuestion => ({
    questionVersionId: id,
    topicId,
    topic: `Topic ${topicId}`,
    marks,
    correctOptionId: correct,
});

describe('scoreAttempt', () => {
    const questions = [q(1, 1, 10), q(2, 1, 20), q(3, 2, 30), q(4, 2, 40)];

    it('awards the marks of each correct answer and nothing else', () => {
        const result = scoreAttempt(
            questions,
            [
                { questionVersionId: 1, selectedOptionId: 10 }, // right
                { questionVersionId: 2, selectedOptionId: 99 }, // wrong: no marks, nothing taken off
                { questionVersionId: 3, selectedOptionId: null }, // cleared
            ],
            50,
        );
        expect(result).toMatchObject({ totalMarks: 20, obtainedMarks: 5, percentage: 25, passed: false });
        expect(result.graded).toEqual([
            { questionVersionId: 1, isCorrect: true, marksAwarded: 5 },
            { questionVersionId: 2, isCorrect: false, marksAwarded: 0 },
            { questionVersionId: 3, isCorrect: false, marksAwarded: 0 },
        ]);
    });

    it('breaks the score down by topic, counting every question asked', () => {
        const result = scoreAttempt(questions, [{ questionVersionId: 3, selectedOptionId: 30 }], 50);
        expect(result.sections).toEqual([
            { topicId: 1, topic: 'Topic 1', questions: 2, answered: 0, correct: 0, totalMarks: 10, obtainedMarks: 0 },
            { topicId: 2, topic: 'Topic 2', questions: 2, answered: 1, correct: 1, totalMarks: 10, obtainedMarks: 5 },
        ]);
    });

    it('passes at exactly the pass mark, using the percentage that is stored', () => {
        const answers = [
            { questionVersionId: 1, selectedOptionId: 10 },
            { questionVersionId: 3, selectedOptionId: 30 },
        ];
        expect(scoreAttempt(questions, answers, 50)).toMatchObject({ percentage: 50, passed: true });
        expect(scoreAttempt(questions, answers, 51).passed).toBe(false);
    });

    it('rounds the percentage to two decimals', () => {
        const three = [q(1, 1, 10, 1), q(2, 1, 20, 1), q(3, 1, 30, 1)];
        expect(scoreAttempt(three, [{ questionVersionId: 1, selectedOptionId: 10 }], 50).percentage).toBe(33.33);
    });

    it('scores zero, without dividing by zero, when nothing was scored', () => {
        expect(scoreAttempt([], [], 50)).toMatchObject({ totalMarks: 0, percentage: 0, passed: false });
    });
});
