// The limits store (task 3.4, D-39): LimitHit rows are the sliding window's history; the pure engine decides. One
// allowed action = one row; a refusal writes nothing (L-3). The check and the record happen under a per-(profile,
// action) advisory lock so two simultaneous attempts cannot both squeeze under the limit. Young-account status
// (task 3.5) is computed here from Profile.joinedAt and live contributions (L-1, L-5).
import { checkLimit, isYoung, type LimitVerdict } from '@/limits';
import type { Action, LimitRules } from '@/rules';
import { contributionsAt, lockKey, toDate, toEpoch, type Tx } from './db';

export type GuardInput = { orgId: string; profileId: string; action: Action; at: number };
export type GuardResult = LimitVerdict & { young: boolean };

/** Longest window in the rules: rows older than this are never read again and can be swept. */
export const retentionSeconds = (rules: LimitRules): number => Math.max(...rules.windows.map((w) => w.per_seconds));

export async function accountAt(tx: Tx, profileId: string, at: number): Promise<{ created_at: number; contributions: number }> {
  const p = await tx.profile.findUniqueOrThrow({ where: { id: profileId }, select: { joinedAt: true } });
  return { created_at: toEpoch(p.joinedAt), contributions: await contributionsAt(tx, profileId, toDate(at)) };
}

/** Check the window and, if allowed, record the hit. Returns the engine's verdict plus the young flag used. */
export async function guardAndRecord(tx: Tx, g: GuardInput, rules: LimitRules): Promise<GuardResult> {
  await lockKey(tx, `limit:${g.profileId}:${g.action}`);
  const w = rules.windows.find((x) => x.action === g.action)!;
  const at = toDate(g.at);
  const rows = await tx.limitHit.findMany({
    where: { profileId: g.profileId, action: g.action, at: { gt: toDate(g.at - w.per_seconds), lte: at } },
    select: { at: true },
  });
  const young = isYoung(await accountAt(tx, g.profileId, g.at), g.at, rules);
  const verdict = checkLimit(
    rows.map((r) => toEpoch(r.at)),
    g.action,
    young,
    g.at,
    rules,
  );
  if (verdict.verdict === 'allow') await tx.limitHit.create({ data: { orgId: g.orgId, profileId: g.profileId, action: g.action, at } });
  return { ...verdict, young };
}

/** Cron: delete rows older than the longest window. */
export async function sweepLimitHits(tx: Tx, now: number, rules: LimitRules): Promise<number> {
  const r = await tx.limitHit.deleteMany({ where: { at: { lt: toDate(now - retentionSeconds(rules)) } } });
  return r.count;
}
