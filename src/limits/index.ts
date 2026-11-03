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
