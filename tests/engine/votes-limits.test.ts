// GL-01..GL-14 (brief §4) and the V- rules in TypeScript (tasks 1.7, 1.8).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkLimit, downvoteAllowed, isYoung, replay, replayComments } from '@/limits';
import { parseLimitRules } from '@/rules';
import { reduceVotes, type VoteEventIn } from '@/votes';

const rules = parseLimitRules(JSON.parse(readFileSync('rules/limits.json', 'utf8')));
const T0 = 1_793_232_000;
const DAY = 86_400;

describe('gates (L-1, L-2)', () => {
  it('GL-01..04 young boundaries are strict', () => {
    expect(isYoung({ created_at: T0, contributions: 5 }, T0 + DAY - 1, rules)).toBe(true);
    expect(isYoung({ created_at: T0, contributions: 5 }, T0 + DAY, rules)).toBe(false);
    expect(isYoung({ created_at: T0, contributions: 4 }, T0 + 30 * DAY, rules)).toBe(true);
    expect(isYoung({ created_at: T0, contributions: 5 }, T0 + 30 * DAY, rules)).toBe(false);
  });
  it('GL-05..07 downvote gate', () => {
    expect(downvoteAllowed({ created_at: T0, contributions: 3 }, T0 + DAY - 1, rules)).toBe(false);
    expect(downvoteAllowed({ created_at: T0, contributions: 3 }, T0 + DAY, rules)).toBe(true);
    expect(downvoteAllowed({ created_at: T0, contributions: 2 }, T0 + 400 * DAY, rules)).toBe(false);
  });
});

describe('sliding window (L-3, L-4)', () => {
  it('GL-08/09 young comment limit 2 per 60 s, retryAfter 58', () => {
    expect(checkLimit([T0, T0 + 1], 'comment', true, T0 + 2, rules)).toEqual({ verdict: 'refuse', retryAfter: 58 });
  });
  it('GL-10/11 a hit exactly 60 s old has left the window; 59 s has not', () => {
    expect(checkLimit([T0, T0 + 1], 'comment', true, T0 + 60, rules)).toEqual({ verdict: 'allow' });
    expect(checkLimit([T0, T0 + 1], 'comment', true, T0 + 59, rules).verdict).toBe('refuse');
  });
  it('GL-12 retryAfter floor is 1', () => {
    expect(checkLimit([T0 - 59, T0 - 59], 'comment', true, T0, rules)).toEqual({ verdict: 'refuse', retryAfter: 1 });
  });
  it('GL-13/14 regular comment limit is 6', () => {
    expect(checkLimit([0, 1, 2, 3, 4].map((i) => T0 + i), 'comment', false, T0 + 5, rules).verdict).toBe('allow');
    expect(checkLimit([0, 1, 2, 3, 4, 5].map((i) => T0 + i), 'comment', false, T0 + 6, rules).verdict).toBe('refuse');
  });
  // PRD 6.4 (D-93): the profile+post comment window and max_depth_written
  const aged = { a: T0 - 30 * DAY };
  const many = () => 100;
  it('GL-23 thread window 10/3600 s: 9 allow, 10 refuse with retryAfter 3590', () => {
    expect(checkLimit([0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => T0 + i), 'comment', false, T0 + 9, rules, 'profile+post')).toEqual({ verdict: 'allow' });
    expect(checkLimit([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => T0 + i), 'comment', false, T0 + 10, rules, 'profile+post')).toEqual({ verdict: 'refuse', retryAfter: 3590 });
  });
  it('GL-24 young thread window is 3', () => {
    expect(checkLimit([T0, T0 + 100], 'comment', true, T0 + 200, rules, 'profile+post').verdict).toBe('allow');
    expect(checkLimit([T0, T0 + 100, T0 + 200], 'comment', true, T0 + 300, rules, 'profile+post').verdict).toBe('refuse');
  });
  it('the profile rows are unchanged by the scoped row', () => {
    expect(checkLimit([0, 1, 2, 3, 4].map((i) => T0 + i), 'comment', false, T0 + 5, rules)).toEqual({ verdict: 'allow' });
    expect(checkLimit([T0, T0 + 1], 'comment', true, T0 + 2, rules)).toEqual({ verdict: 'refuse', retryAfter: 58 });
  });
  it('GL-25 the scoped row refuses the 11th comment on one post in an hour, and allows a 7th on another post', () => {
    const onOne = replayComments(Array.from({ length: 11 }, (_, i) => ({ t: T0 + 70 * i, user: 'a', post: 'P1', depth: 0 })), aged, many, rules);
    expect(onOne).toEqual({ allowed: 10, refused: 1, firstRetryAfter: 3600 - 700 });
    const split = replayComments(Array.from({ length: 11 }, (_, i) => ({ t: T0 + 70 * i, user: 'a', post: i < 4 ? 'P1' : 'P2', depth: 0 })), aged, many, rules);
    expect(split).toEqual({ allowed: 11, refused: 0, firstRetryAfter: null });
  });
  it('GL-26 max_depth_written 32: depth 32 allowed, 33 refused with no retryAfter, and it spends no slot', () => {
    const r = replayComments([{ t: T0, user: 'a', post: 'P', depth: 32 }, { t: T0 + 100, user: 'a', post: 'P', depth: 33 }], aged, many, rules);
    expect(r).toEqual({ allowed: 1, refused: 1, firstRetryAfter: null });
  });
  it('replay: 100 young votes at 1/s allows 20 (two windows), first retryAfter 50', () => {
    const r = replay(Array.from({ length: 100 }, (_, i) => T0 + i), 'vote', { created_at: T0 - 3600, contributionsAt: () => 0 }, rules);
    expect(r).toEqual({ allowed: 20, refused: 80, firstRetryAfter: 50 });
  });
});

describe('vote reducer (V-1..V-5)', () => {
  const nodes = new Map([
    ['n1', 'alice'],
    ['n2', 'bob'],
  ]);
  const old = { created_at: T0 - 100 * DAY, contributions: 10 };
  const young = { created_at: T0 - 3600, contributions: 0 };
  const accountAt = (voter: string) => (voter === 'kid' ? young : old);
  const ev = (row: number, voter: string, node_id: string, value: 1 | -1, cast_at: number): VoteEventIn => ({ row, voter, node_id, value, cast_at });
  it('V-1 the author’s +1 is fixed; self events are SELF_VOTE', () => {
    const { counts, outcomes } = reduceVotes(nodes, [ev(1, 'alice', 'n1', -1, T0), ev(2, 'alice', 'n1', 1, T0 + 1)], accountAt, rules);
    expect(counts.get('n1')).toEqual({ ups: 1, downs: 0 });
    expect([...outcomes.values()]).toEqual(['SELF_VOTE', 'SELF_VOTE']);
  });
  it('V-2 a gated downvote changes nothing', () => {
    const { counts, outcomes } = reduceVotes(nodes, [ev(1, 'kid', 'n1', -1, T0), ev(2, 'kid', 'n1', 1, T0 + 1)], accountAt, rules);
    expect(outcomes.get(1)).toBe('GATED_DOWNVOTE');
    expect(outcomes.get(2)).toBe('APPLIED');
    expect(counts.get('n1')).toEqual({ ups: 2, downs: 0 });
  });
  it('V-3/V-4 toggle and switch in (cast_at, row) order regardless of input order', () => {
    const events = [ev(3, 'carol', 'n2', 1, T0 + 2), ev(1, 'carol', 'n2', 1, T0), ev(2, 'carol', 'n2', -1, T0 + 1)];
    const { counts, outcomes } = reduceVotes(nodes, events, accountAt, rules);
    expect([outcomes.get(1), outcomes.get(2), outcomes.get(3)]).toEqual(['APPLIED', 'SWITCHED', 'SWITCHED']);
    expect(counts.get('n2')).toEqual({ ups: 2, downs: 0 });
    const t = reduceVotes(nodes, [ev(1, 'carol', 'n2', 1, T0), ev(2, 'carol', 'n2', 1, T0 + 1)], accountAt, rules);
    expect(t.outcomes.get(2)).toBe('TOGGLED_OFF');
    expect(t.counts.get('n2')).toEqual({ ups: 1, downs: 0 });
  });
  it('unknown node is reported, not thrown', () => {
    expect(reduceVotes(nodes, [ev(1, 'carol', 'nope', 1, T0)], accountAt, rules).outcomes.get(1)).toBe('UNKNOWN_NODE');
  });
});
