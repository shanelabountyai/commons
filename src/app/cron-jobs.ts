import { readFileSync } from 'node:fs';
import { db } from '@/core/db';
import { sweepLimitHits } from '@/forum/limits-store';
import { recomputeRanks } from '@/forum/rank';
import { drainOutbox, sweepOutbox } from '@/modules/notifications/outbox'; // notifications
import { parseLimitRules, parseRankingRules } from '@/rules';

// Clone-owned (plan §3.2): /api/cron calls this after its own core sweeps. A clone adds its jobs here,
// and removing the notifications module deletes the lines marked `// notifications`.
const ranking = parseRankingRules(JSON.parse(readFileSync('rules/ranking.json', 'utf8')));
const limits = parseLimitRules(JSON.parse(readFileSync('rules/limits.json', 'utf8')));

export async function cronJobs(): Promise<Record<string, unknown>> {
  const jobs: Record<string, unknown> = {};
  jobs.outbox = { ...(await drainOutbox()), swept: await sweepOutbox() }; // notifications
  // R-5: the ranking cache, every org with a forum. rules.recompute.interval_seconds is the intended cadence; the
  // template cron fires on its own schedule (vercel.json), so a run that comes sooner is harmless and one that comes
  // later shows in rankedAt.
  const now = Math.floor(Date.now() / 1000);
  const orgs = await db.post.groupBy({ by: ['orgId'], _count: { _all: true } });
  const ranked: Record<string, { posts: number; comments: number }> = {};
  for (const o of orgs) ranked[o.orgId] = await db.$transaction((tx) => recomputeRanks(tx, o.orgId, now, ranking), { timeout: 120_000 });
  jobs.rank = { orgs: orgs.length, ranked, intervalSeconds: ranking.recompute.interval_seconds };
  jobs.limitHits = { swept: await db.$transaction((tx) => sweepLimitHits(tx, now, limits)) }; // D-39: rows past the longest window
  return jobs;
}
