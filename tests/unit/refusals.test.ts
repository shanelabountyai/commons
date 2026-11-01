// 4.1.4 / 4.1.14: the door's refusals, said plainly, with the code kept in the text (grep-able) and the numbers kept.
import { describe, expect, it } from 'vitest';
import { RateLimited } from '@/forum/actions';
import { ForumRefused } from '@/forum/db';
import { refusalText } from '@/forum/refusals';

describe('refusal text', () => {
  it('BANNED_UNTIL carries the lift time, not "for now" (D-14, task 4.2 acceptance)', () => {
    const t = refusalText(new ForumRefused('BANNED_UNTIL', '1793318400'));
    expect(t).toBe('Your account is banned until 2026-10-30 00:00 UTC. (BANNED_UNTIL)');
  });
  it('RATE_LIMITED keeps retryAfter and the action', () => {
    expect(refusalText(new RateLimited('comment', 58))).toBe('Slow down: too many comments. Try again in 58 s. (RATE_LIMITED)');
  });
  it('INPUT_INVALID keeps the detail; UNKNOWN_NODE is null (the caller answers not-found)', () => {
    expect(refusalText(new ForumRefused('INPUT_INVALID', 'body contains a NUL byte'))).toBe('Check the form: body contains a NUL byte. (INPUT_INVALID)');
    expect(refusalText(new ForumRefused('UNKNOWN_NODE', 'POST x'))).toBeNull();
  });
  it('4.1.14: a second report is ALREADY_REPORTED, not a form error', () => {
    expect(refusalText(new ForumRefused('ALREADY_REPORTED', 'POST x'))).toBe('You already reported this; a moderator will look at it. (ALREADY_REPORTED)');
  });
  it('an unknown error is not translated', () => {
    expect(refusalText(new Error('boom'))).toBeNull();
  });
});
