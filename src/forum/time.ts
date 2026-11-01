// Time words for the pages (4.1.13). Pure: `now` is a parameter, so the words are unit-tested and never print
// "10080 min ago". Absolute times are UTC to the minute; the pages wrap both in <time dateTime>.
export const when = (d: Date): string => d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

export function ago(d: Date | null, now: Date): string {
  if (!d) return 'not yet';
  const s = Math.round((now.getTime() - d.getTime()) / 1000);
  const future = s < 0;
  const a = Math.abs(s);
  const word = a < 60 ? null : a < 3600 ? `${Math.floor(a / 60)} min` : a < 86_400 ? `${Math.floor(a / 3600)} h` : `${Math.floor(a / 86_400)} d`;
  if (!word) return 'just now';
  return future ? `in ${word}` : `${word} ago`;
}
