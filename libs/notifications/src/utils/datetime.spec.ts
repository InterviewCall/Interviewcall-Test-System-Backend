import { formatTime, formatWindow } from './datetime.js';

describe('formatWindow', () => {
    it('writes a same-day window in Indian time, whatever the server zone', () => {
        // 05:30 UTC is 11:00 in India.
        expect(formatWindow(new Date('2026-10-24T05:30:00Z'), new Date('2026-10-24T06:30:00Z'))).toBe(
            '24 October 2026, 11:00 AM – 12:00 PM IST',
        );
    });

    it('shows both dates when the window crosses midnight in India', () => {
        expect(formatWindow(new Date('2026-10-24T17:30:00Z'), new Date('2026-10-24T19:30:00Z'))).toBe(
            '24 October 2026, 11:00 PM – 25 October 2026, 1:00 AM IST',
        );
    });

    it('uses the Indian date, not the UTC date', () => {
        // 20:00 UTC on the 24th is already 01:30 on the 25th in India.
        expect(formatWindow(new Date('2026-10-24T20:00:00Z'), new Date('2026-10-24T21:00:00Z'))).toBe(
            '25 October 2026, 1:30 AM – 2:30 AM IST',
        );
    });

    it('writes noon and midnight clearly', () => {
        expect(formatTime(new Date('2026-10-24T06:30:00Z'))).toBe('12:00 PM');
        expect(formatTime(new Date('2026-10-24T18:30:00Z'))).toBe('12:00 AM');
    });
});
