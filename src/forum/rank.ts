// The ranking job (task 2.6, R-5): reads every node's cached counts, scores them with the pure engine, and replaces
// the org's RankSnapshot rows in one transaction. `now` is a parameter so the fixture replay can rank at NOW.
import { hot, net, wilsonLower } from '@/ranking';
import type { RankingRules } from '@/rules';
import { toDate, toEpoch, type Tx } from './db';

export async function recomputeRanks(tx: Tx, orgId: string, now: number, rules: RankingRules): Promise<{ posts: number; comments: number }> {
  const posts = await tx.post.findMany({ where: { orgId }, select: { id: true, createdAt: true, ups: true, downs: true } });
  const comments = await tx.comment.findMany({ where: { orgId }, select: { id: true, createdAt: true, ups: true, downs: true } });
  const rankedAt = toDate(now);
  const rows = [
    ...posts.map((p) => ({ nodeKind: 'POST' as const, ...p })),
    ...comments.map((c) => ({ nodeKind: 'COMMENT' as const, ...c })),
  ].map((n) => {
    const counts = { ups: n.ups, downs: n.downs };
    return {
      orgId,
      nodeKind: n.nodeKind,
      nodeId: n.id,
      rankedAt,
      hot: hot(counts, toEpoch(n.createdAt), rules),
      best: wilsonLower(counts, rules.best.z),
      net: net(counts),
      ups: n.ups,
      downs: n.downs,
      createdAt: n.createdAt,
    };
  });
  await tx.rankSnapshot.deleteMany({ where: { orgId } });
  for (let i = 0; i < rows.length; i += 1000) await tx.rankSnapshot.createMany({ data: rows.slice(i, i + 1000) });
  return { posts: posts.length, comments: comments.length };
}
