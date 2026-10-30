// Ranking engine (brief §3 R-1..R-4, D-7..D-9). Pure: `now` is a parameter, constants come from the parsed
// rules, nothing here reads a clock, a file or a database (engine:lint). Written from the brief, not from
// tools/rankinglib.py; the oracle agreement is proven by tests/engine/ranking.test.ts and engine:eval.
import type { RankingRules, TopWindow } from '@/rules';

export type Counts = { ups: number; downs: number };
export type Ranked = { id: string; created_at: number };
export type PostSort = 'hot' | 'top_day' | 'top_week' | 'top_all' | 'new';
export type CommentSort = 'best' | 'top' | 'new';

/** R-1: log-scaled net score plus a creation-time term; independent of `now`; rounded to 7 places. */
export function hot(c: Counts, created_at: number, rules: RankingRules): number {
  const s = c.ups - c.downs;
  const order = Math.log10(Math.max(Math.abs(s), 1));
  const sign = s > 0 ? 1 : s < 0 ? -1 : 0;
  const seconds = created_at - rules.hot.epoch_seconds;
  return round7(sign * order + seconds / rules.hot.gravity_seconds);
}

/** R-4: lower bound of the Wilson score interval for the up-vote proportion; n = ups + downs; 0 when n = 0. */
export function wilsonLower(c: Counts, z: number): number {
  const n = c.ups + c.downs;
  if (n === 0) return 0;
  const p = c.ups / n;
  const z2 = z * z;
  return (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / (1 + z2 / n);
}

/** R-2: created within (now − window, now]; `all` has no lower bound; future-dated nodes are never in a window. */
export function inTopWindow(created_at: number, now: number, window: TopWindow, rules: RankingRules): boolean {
  const w = rules.top.windows_seconds[window];
  return created_at <= now && (w === null || created_at >= now - w);
}

export const net = (c: Counts): number => c.ups - c.downs;

/** D-9 tiebreak: higher score first, then newer first, then id ascending. For `new`, created desc is the sort itself (C-6). */
function byScoreThenTie<T extends Ranked>(score: (x: T) => number) {
  return (a: T, b: T) => score(b) - score(a) || b.created_at - a.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function orderPosts<T extends Ranked>(posts: readonly T[], counts: (id: string) => Counts, sort: PostSort, now: number, rules: RankingRules): T[] {
  switch (sort) {
    case 'hot':
      return [...posts].sort(byScoreThenTie((p) => hot(counts(p.id), p.created_at, rules)));
    case 'new':
      return [...posts].sort(byScoreThenTie(() => 0));
    default: {
      const window = sort.slice(4) as TopWindow;
      return posts.filter((p) => inTopWindow(p.created_at, now, window, rules)).sort(byScoreThenTie((p) => net(counts(p.id))));
    }
  }
}

export function orderSiblings<T extends Ranked>(siblings: readonly T[], counts: (id: string) => Counts, sort: CommentSort, rules: RankingRules): T[] {
  switch (sort) {
    case 'best':
      return [...siblings].sort(byScoreThenTie((c) => wilsonLower(counts(c.id), rules.best.z)));
    case 'top':
      return [...siblings].sort(byScoreThenTie((c) => net(counts(c.id))));
    case 'new':
      return [...siblings].sort(byScoreThenTie(() => 0));
  }
}

export const round7 = (x: number): number => Math.round(x * 1e7) / 1e7;
