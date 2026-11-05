// Gates and limits engine (brief §3a L-1..L-5; D-15, D-23, D-24). Pure: history and `now` are inputs; nothing is
// stored here (Phase 3 wires storage). Written from the brief, not from tools/limitslib.py.
import type { Action, LimitRules, Scope } from '@/rules';
import { windowFor } from '@/rules';

export type Account = { created_at: number; contributions: number };
export type LimitVerdict = { verdict: 'allow' } | { verdict: 'refuse'; retryAfter: number };

/** L-1: age < 24 h OR contributions < 5; both boundaries strict. */
export function isYoung(a: Account, now: number, rules: LimitRules): boolean {
  return now - a.created_at < rules.young_account.max_age_hours * 3600 || a.contributions < rules.young_account.max_contributions;
}

/** L-2: age ≥ 24 h AND contributions ≥ 3. */
export function downvoteAllowed(a: Account, now: number, rules: LimitRules): boolean {
  return now - a.created_at >= rules.downvote_gate.min_age_hours * 3600 && a.contributions >= rules.downvote_gate.min_contributions;
}

/**
 * L-3/L-4: `history` holds the epoch seconds of this user's COUNTED (allowed) hits for `action`. Allowed when the
 * hits with now − per < t ≤ now number fewer than the limit; otherwise refused with retryAfter = oldest counted
 * hit + per − now, floor 1. With scope 'profile+post' the caller passes the member's hits on that one post (D-93).
 */
export function checkLimit(history: readonly number[], action: Action, young: boolean, now: number, rules: LimitRules, scope: Scope = 'profile'): LimitVerdict {
  const w = windowFor(rules, action, scope);
  const limit = young ? w.young_max : w.max;
  const counted = history.filter((t) => now - w.per_seconds < t && t <= now).sort((a, b) => a - b);
  if (counted.length < limit) return { verdict: 'allow' };
  return { verdict: 'refuse', retryAfter: Math.max(1, counted[0]! + w.per_seconds - now) };
}

export type Replay = { allowed: number; refused: number; firstRetryAfter: number | null };

/** Replays attempts (sorted ascending) against an account whose contributions may change over time. */
export function replay(attempts: readonly number[], action: Action, account: { created_at: number; contributionsAt: (t: number) => number }, rules: LimitRules): Replay {
  const hist: number[] = [];
  const out: Replay = { allowed: 0, refused: 0, firstRetryAfter: null };
  for (const t of attempts) {
    const young = isYoung({ created_at: account.created_at, contributions: account.contributionsAt(t) }, t, rules);
    const v = checkLimit(hist, action, young, t, rules);
    if (v.verdict === 'allow') {
      hist.push(t);
      out.allowed++;
    } else {
      out.refused++;
      out.firstRetryAfter ??= v.retryAfter;
    }
  }
  return out;
}

export type CommentAttempt = { t: number; user: string; post: string; depth: number };

/**
 * PRD 6.4 (D-93). Attempts sorted ascending; depth per T-2 (top level 0). A depth past max_depth_written is refused
 * first, with no retryAfter, and spends no slot. Then each scope's comment window in order; the first refusal wins.
 * An allowed attempt counts in every scope's history.
 */
export function replayComments(
  attempts: readonly CommentAttempt[],
  createdAt: Readonly<Record<string, number>>,
  contributionsAt: (user: string, t: number) => number,
  rules: LimitRules,
  scopes: readonly Scope[] = ['profile', 'profile+post'],
): Replay {
  const hist = new Map<string, number[]>();
  const out: Replay = { allowed: 0, refused: 0, firstRetryAfter: null };
  for (const a of attempts) {
    if (a.depth > rules.max_depth_written) {
      out.refused++;
      continue;
    }
    const young = isYoung({ created_at: createdAt[a.user]!, contributions: contributionsAt(a.user, a.t) }, a.t, rules);
    const keys = scopes.map((s) => [s, s === 'profile' ? `${s}|${a.user}` : `${s}|${a.user}|${a.post}`] as const);
    let v: LimitVerdict = { verdict: 'allow' };
    for (const [s, k] of keys) {
      v = checkLimit(hist.get(k) ?? [], 'comment', young, a.t, rules, s);
      if (v.verdict === 'refuse') break;
    }
    if (v.verdict === 'allow') {
      for (const [, k] of keys) hist.set(k, [...(hist.get(k) ?? []), a.t]);
      out.allowed++;
    } else {
      out.refused++;
      out.firstRetryAfter ??= v.retryAfter;
    }
  }
  return out;
}

/** PRD 7.3 (D-104): the slots an edit asks: the multiset difference after − before of the two bodies' hrefs, so
 *  keeping, removing or reordering links asks nothing and moving a link to a new host asks one. */
export function addedLinks(before: readonly string[], after: readonly string[]): number {
  const left = new Map<string, number>();
  for (const h of before) left.set(h, (left.get(h) ?? 0) + 1);
  let added = 0;
  for (const h of after) {
    const n = left.get(h) ?? 0;
    if (n > 0) left.set(h, n - 1);
    else added++;
  }
  return added;
}

/** A body with `links` links asks the profile `link` window once per link, its own earlier links counting at `now`;
 *  the first refusal refuses the whole body. `history` is the member's link timestamps (one entry per link). */
export function checkLinks(history: readonly number[], links: number, young: boolean, now: number, rules: LimitRules): LimitVerdict {
  const h = [...history];
  for (let i = 0; i < links; i++) {
    const v = checkLimit(h, 'link', young, now, rules);
    if (v.verdict === 'refuse') return v;
    h.push(now);
  }
  return { verdict: 'allow' };
}

export type LinkAttempt = { t: number; user: string; links: number };

/** Bodies sorted ascending; an allowed body adds `links` hits at t, a refused one records nothing. Counted in bodies. */
export function replayLinks(attempts: readonly LinkAttempt[], createdAt: Readonly<Record<string, number>>, contributionsAt: (user: string, t: number) => number, rules: LimitRules): Replay {
  const hist = new Map<string, number[]>();
  const out: Replay = { allowed: 0, refused: 0, firstRetryAfter: null };
  for (const a of attempts) {
    const young = isYoung({ created_at: createdAt[a.user]!, contributions: contributionsAt(a.user, a.t) }, a.t, rules);
    const h = hist.get(a.user) ?? [];
    const v = checkLinks(h, a.links, young, a.t, rules);
    if (v.verdict === 'allow') {
      hist.set(a.user, [...h, ...Array<number>(a.links).fill(a.t)]);
      out.allowed++;
    } else {
      out.refused++;
      out.firstRetryAfter ??= v.retryAfter;
    }
  }
  return out;
}
