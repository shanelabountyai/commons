// GH-01..GH-07, GW-01..GW-08, GT-01..GT-03 (brief §4) in TypeScript, at the oracle's tolerances (D-9, D-10).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hot, inTopWindow, orderPosts, wilsonLower } from '@/ranking';
import { parseRankingRules } from '@/rules';

const rules = parseRankingRules(JSON.parse(readFileSync('rules/ranking.json', 'utf8')));
const T0 = 1_793_232_000;
const H = 3600;
const c = (ups: number, downs = 0) => ({ ups, downs });

describe('hot (R-1)', () => {
  const old = hot(c(50), T0, rules);
  it('GH-01 50 votes at T0 beats 5 votes at T0+12h', () => expect(hot(c(5), T0 + 12 * H, rules)).toBeLessThan(old));
  it('GH-02 loses to 5 votes at T0+13h', () => expect(hot(c(5), T0 + 13 * H, rules)).toBeGreaterThan(old));
  it('GH-03 loses to 5 votes at T0+24h', () => expect(hot(c(5), T0 + 24 * H, rules)).toBeGreaterThan(old));
  it('GH-04 crossover offset is 45000 s', () => expect(Math.round((old - hot(c(5), T0, rules)) * 45_000)).toBe(45_000));
  it('GH-05 net 0 and net -1 score the same (D-11)', () => expect(hot(c(0), T0, rules)).toBe(hot(c(0, 1), T0, rules)));
  it('GH-06 net -10 ranks below net 0', () => expect(hot(c(0, 10), T0, rules)).toBeLessThan(hot(c(0), T0, rules)));
  it('GH-07 hot(50, 0, T0) = 14650.6766811 (hand-checked)', () => expect(Math.abs(old - 14650.6766811)).toBeLessThanOrEqual(1e-7));
});

describe('best / Wilson lower bound (R-4)', () => {
  const w = (u: number, n: number) => wilsonLower(c(u, n - u), rules.best.z);
  it('GW-01 1/1 ranks below 70/100', () => expect(w(1, 1)).toBeLessThan(w(70, 100)));
  it('GW-02 2/2 ranks below 70/100', () => expect(w(2, 2)).toBeLessThan(w(70, 100)));
  it('GW-03 1/2 ranks below 70/100', () => expect(w(1, 2)).toBeLessThan(w(70, 100)));
  it('GW-04 10/10 ranks above 70/100', () => expect(w(10, 10)).toBeGreaterThan(w(70, 100)));
  it('GW-05 n = 0 scores 0', () => expect(w(0, 0)).toBe(0));
  it('GW-06..08 values within 5e-5', () => {
    expect(Math.abs(w(70, 100) - 0.6042)).toBeLessThanOrEqual(5e-5);
    expect(Math.abs(w(1, 1) - 0.2065)).toBeLessThanOrEqual(5e-5);
    expect(Math.abs(w(10, 10) - 0.7225)).toBeLessThanOrEqual(5e-5);
  });
});

describe('top windows (R-2)', () => {
  const now = T0 + 7 * 24 * H;
  it('GT-01 exactly 24 h old is in day', () => expect(inTopWindow(now - 86_400, now, 'day', rules)).toBe(true));
  it('GT-02 24 h + 1 s is not', () => expect(inTopWindow(now - 86_401, now, 'day', rules)).toBe(false));
  it('GT-03 future-dated is in no window', () => expect(inTopWindow(now + 1, now, 'all', rules)).toBe(false));
  it('orderPosts top_day filters and sorts by net, then newest, then id', () => {
    const posts = [
      { id: 'b', created_at: now - 10 },
      { id: 'a', created_at: now - 10 },
      { id: 'old', created_at: now - 90_000 },
      { id: 'c', created_at: now - 5 },
    ];
    const counts = (id: string) => ({ a: c(3), b: c(3), c: c(1), old: c(99) })[id]!;
    expect(orderPosts(posts, counts, 'top_day', now, rules).map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(orderPosts(posts, counts, 'new', now, rules).map((p) => p.id)).toEqual(['c', 'a', 'b', 'old']);
  });
});
