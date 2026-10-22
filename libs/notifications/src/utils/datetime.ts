const ZONE = 'Asia/Kolkata';

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: ZONE });
const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: ZONE });

/** "24 October 2026" in Indian time. */
export const formatDate = (date: Date): string => dateFormat.format(date);

/** "11:00 AM" in Indian time. */
export const formatTime = (date: Date): string => timeFormat.format(date).replace(/\s*([ap])m$/i, (_m, c: string) => ` ${c.toUpperCase()}M`);

/**
 * How a test window reads in an email, always in Indian time:
 * "24 October 2026, 11:00 AM – 12:00 PM IST", or with both dates when it crosses midnight.
 */
export function formatWindow(startsAt: Date, endsAt: Date): string {
    const start = `${formatDate(startsAt)}, ${formatTime(startsAt)}`;
    const sameDay = formatDate(startsAt) === formatDate(endsAt);
    const end = sameDay ? formatTime(endsAt) : `${formatDate(endsAt)}, ${formatTime(endsAt)}`;
    return `${start} – ${end} IST`;
}
