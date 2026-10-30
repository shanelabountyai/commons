// 4.1.13: relative times scale their unit and never say "10080 min ago"; absolute times are UTC to the minute.
import { describe, expect, it } from 'vitest';
import { ago, when } from '@/forum/time';

const now = new Date('2026-10-30T12:00:00Z');
describe('time words', () => {
  it('ago scales min → h → d and floors at "just now"', () => {
    expect(ago(new Date('2026-10-30T11:59:40Z'), now)).toBe('just now');
    expect(ago(new Date('2026-10-30T11:48:00Z'), now)).toBe('12 min ago');
    expect(ago(new Date('2026-10-30T09:00:00Z'), now)).toBe('3 h ago');
    expect(ago(new Date('2026-10-23T12:00:00Z'), now)).toBe('7 d ago');
    expect(ago(new Date('2026-11-05T00:00:00Z'), now)).toBe('in 5 d'); // a ranking snapshot at the fixture instant is in the future
    expect(ago(null, now)).toBe('not yet');
  });
  it('when is UTC to the minute', () => {
    expect(when(new Date('2026-10-30T00:05:00Z'))).toBe('2026-10-30 00:05 UTC');
  });
});
