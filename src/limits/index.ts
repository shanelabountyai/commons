// Gates and limits engine (brief §3a L-1..L-5; D-15, D-23, D-24). Pure: history and `now` are inputs; nothing is
// stored here (Phase 3 wires storage). Written from the brief, not from tools/limitslib.py.
import type { Action, LimitRules } from '@/rules';
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
 * hit + per − now, floor 1.
 */
export function checkLimit(history: readonly number[], action: Action, young: boolean, now: number, rules: LimitRules): LimitVerdict {
  const w = windowFor(rules, action);
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
